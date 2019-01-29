import _ from 'lodash'
import moment from 'moment'
import { isStaff, isTargetUser, isAdmin, isActiveUser, isTargetUserOrStaff, isAcctOwner }  from '../auth/auth.mjs'

import Stripe from 'stripe'
import { handleStripeError } from '../util/stripeHandle.mjs'

const stripe = Stripe(process.env.STRIPE_KEY)

export const accountTypeList = ['PERSONAL', 'BUSINESS', 'SPECIAL']

//Custom schema


export const addAccountForNewUser = async (ctx, accountType, owner_id) => {
    try {
        //1. check for access requirement
        const args = {
            accountType: accountType,
            owner_id: owner_id
        }
        console.log('Account.addAccountForNewUser, args=', args)
        const ownerCheck = await ctx.db['p001'].collection('User').findOne({_id: args.owner_id}, {projection:{isActive: 1, verificationPIN: 1}})

        if (ownerCheck.isActive || ownerCheck.verificationPIN===undefined) {
            console.error('Error: addAccountForNewUser can only be called with brand new user accounts.')
            throw 'Internal Error: addAccountForNewUser can only be called with brand new user accounts.'
        }
        //2. field checking
        //3. add/mod fields
        args['name'] = 'DEFAULT'
        args['isActive'] = false
        args['creationDateTime'] = moment().toDate()
        args['updateDateTime'] = args['creationDateTime']
        args['balance'] = 0
        args['priceList'] = 'DEFAULT'
        args['paymentTerm'] = 'COD'
        args['address_id'] = []
        args['defaultBillingAddress_id'] = null
        args['defaultShippingAddress_id'] = null
        args['manager_id'] = null
        args['viewer_id'] = null
        
        //4. query & return
        const a = await ctx.db['p001'].collection('Account').insertOne(args);
        //No need to update User doc as this is just a sub-function of a mutation
        return a.ops[0]
    } catch(e) { throw e }
}

export const checkAcctforValidPayment = async (ctx, account, account_id) =>{
    //this method checks for stripeCustomerObject.  If stripeCustomerObject exist, return true
    //Fixme potentially this is wrong!  Need to check if there's valid source within the Cus object!
    
    let a
    if (account) { a = account }
    else if (account_id) { 
        const t = Object.assign({a: account_id}, {})
        ctx.spFunction['p001'].convertArgs(t)
        a = await ctx.db['p001'].collection('Account').find({_id: t.a}, {stripeCustomerObject: 1}).limit(1).toArray()
    }
    else { throw new Error('account and account_id both not provided') }
    
    
    let sourceObj =  _.get(a, 'stripeCustomerObject.sources.data', undefined)
    console.log('Account.checkAcctforValidPayment')
    let noOfSources = (sourceObj==undefined)? 0 : sourceObj.length
    
    return (noOfSources>0) ? true: false
}

export const addStripeSource = async (ctx, token, account, account_id) => {
    let a
    if (account) { a = account }
    else if (account_id) { 
        a = await ctx.db['p001'].collection('Account').find({_id: ctx.spFunction['p001'].getIdObj(account_id)}, {_id: 1, stripeCustomerObject: 1}).limit(1).toArray()
        if (a.length<1) { throw new Error('account_id not found') }
        else { a = a[0] }
    }
    else { throw new Error('account and account_id both not provided') }
    
    let cusObj
    try {
        if (!a.stripeCustomerObject) {
            cusObj = await stripe.customers.create({
                email: ctx.req.user.email,
                source: token
            })
        }
        else {
            let newSource = await stripe.customers.createSource(a.stripeCustomerObject.id, {source: token})
            console.log('newSource=', newSource)
            cusObj = await stripe.customers.retrieve(a.stripeCustomerObject.id)
        }
    }
    catch(e) {
        const err = handleStripeError(e)
        console.log(err)
        throw new ctx.err(err)
    }
    console.log(account, account_id, a._id)
    const doc = await ctx.db['p001'].collection('Account').findOneAndUpdate({_id: a._id }, {$set: {stripeCustomerObject: cusObj}} , {returnOriginal: false})
    
    return doc.value
}



export const typeDef = `
    enum accountType {
        PERSONAL
        BUSINESS
        SPECIAL
    }
    
    enum paymentTerms{
        COD
        N30
    }
    
    extend type Query {
        "get a list of user, only staff can access."
        getAccount(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [Account]
        
        "provide account ID, return details"
        getAccountById(_id:String): Account
        
        "return array of accounts for logined user **possible dupe with getAccountById**"
        getMyAccount: [Account]
        
        "get user from ctx.req.user, then retrieve list info for all accounts related to user, plus getting a container count per type of container"
        getAccountListWithInfo: [Account]

    }
    
    extend type Mutation {
        addAccount(name: String!, accountType: String!, owner_id: String!): Account
        
        updateAccount(_id: String!, name: String, manager_id: [String!], viewer_id: [String!]): Account
        
        "Only admin/su can update account owner"
        updateAccountOwner(_id:String!, owner_id: String!): Account
        
        "Only admin/su can update account type"
        updateAccountType(_id: String!, accountType: accountType!): Account
        
        updateAccountBalance(_id: String!, op: numOp!, amt: Float!): Account
        
        addStripeSource(token: String!, account_id: String!): Account
        
        removeStripeSource(token: String!, account_id: String!): Account
    }
    
    type Account {
        _id: ID!,
        name: String,
        accountType: accountType!,
        
        "Is the Price List Code, not Price List ID"
        priceList: [PriceList],
        balance: Float!,
        
        "ID"
        owner_id: User!,
        
        "array of ID"
        manager_id: [User],
        
        "array of ID"
        viewer_id: [User],
        
        "array of ID"
        address_id: [Address],
        
        "ID"
        defaultBillingAddress_id: Address,
        
        "ID"
        defaultShippingAddress_id: Address,
        
        paymentTerm: paymentTerms,
        
        isActive: Boolean!,
        creationDateTime: GraphQLDateTime,
        updateDateTime: GraphQLDateTime,
        stripeCustomerObject: String,
        
        containerList: [Container]
    }`

export const resolver = {
    Query: {
        getAccount: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isStaff(ctx)
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('Account'), args)
                //4. query & return
                const doc = await q.toArray()
                return doc
            } catch(e) { throw e }
        },
        getAccountById: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                console.log('args=', args)
                if (args._id==''|| args._id==undefined) { 
                    console.log(`args._id=${args._id}, return null` )
                    return {}
                    
                }
                //2. field checking
                ctx.spFunction['p001'].convertArgs(args)
                const acct = await ctx.db['p001'].collection('Account').findOne({_id: args._id},{_id: 1, owner_id:1, manager_id: 1, viewer_id: 1})
                if (acct==null) {
                    throw new ctx.err({message: "INVALID", data: {_id: args._id}})
                }
                isTargetUser(ctx, _.concat(acct.owner_id, acct.manager_id, acct.viewer_id))
                //3. add/mod fields
                //4. query & return
                const doc = await ctx.db['p001'].collection('Account').findOne({_id: args._id })
                return doc
            } catch(e) { throw e }
        },
        getMyAccount: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                console.log('getMyAccount called')
                isActiveUser(ctx)
                ctx.spFunction['p001'].convertArgs(ctx.req.user)
                //2. field checking
                //3. add/mod fields
                const myId = ctx.req.user._id
                //4. query & return
                const doc = await ctx.db['p001'].collection('Account').find({$or:[{owner_id: myId}, {manager_id: myId}, {viewer_id: myId} ]}).toArray()
                return doc
            } catch(e) { throw e }
        },
        getAccountListWithInfo: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isActiveUser(ctx)
                console.log('getAccountListWithInfo, user=', ctx.req.user._id)
                const acctList = ctx.db['p001'].collection('Account').find({$or:[{owner_id: myId}, {manager_id: myId}, {viewer_id: myId} ]}).toArray()
                ctx.spFunction['p001'].convertArgs(ctx.req.user)
                //2. field checking
                //3. add/mod fields
                const myId = ctx.req.user._id
                
                //4. query & return
                
                return 1
            } catch(e) { throw e }
        }
    },
    Mutation: {
        addAccount: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                ctx.spFunction['p001'].convertArgs(args)
                isTargetUserOrStaff(ctx, args.owner_id)
                //2. field checking
                const ownerCheck = await ctx.db['p001'].collection('User').findOne({_id: args.owner_id}, {projection:{isActive: 1}})
                if (ownerCheck==null) {
                    throw new ctx.err({message: "NOT_AUTHORIZED", data: {owner_id: args.owner_id}})
                }
                if (!(ownerCheck.isActive)) {
                    throw new ctx.err({message: "SUSPENDED", data: {owner_id: args.owner_id}} )
                }
                //3. add/mod fields
                args['isActive'] = true
                args['creationDateTime'] = moment().toDate()
                args['updateDateTime'] = args['creationDateTime']
                args['balance'] = 0
                args['priceList'] = 'DEFAULT'
                args['paymentTerm'] = 'COD'
                //4. query & return
                const a = await ctx.db['p001'].collection('Account').insertOne(args);
                //Fixme also insert owner into User doc
                return a.ops[0]
            } catch(e) { throw e }
        },
        updateAccount: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                ctx.spFunction['p001'].convertArgs(args)
                console.log('updateAccount, args=', args)
                isAcctOwner(ctx, args._id)
                //2. field checking
                const id = args._id
                const update_fields = _.omit(args, '_id')
                
                if (_.isEmpty(update_fields)) {
                    throw new ctx.err({message: "NO_FIELDS_TO_UPDATE", data: {} })
                }
                
                const allUserIds = _.union(args.manager_id, args.viewer_id)
                if (allUserIds.length > 0) {
                    const userCheck = await ctx.db['p001'].collection('User').find({_id: {$in: allUserIds}}, {projection:{_id: 1}}).toArray() //Fixme toarray gives [{_id:aaa{, {_id:bbb}], change it to real array. same as address
                    console.log(userCheck)
                    let nonExistUsers = _.difference(args.manager_id, userCheck)
                    if (nonExistUsers.length > 0) {
                        throw new ctx.err({message: "NOT_AUTHORIZED", data: {manager_id: nonExistUsers}})
                    }
                    nonExistUsers = _.difference(args.viewer_id, userCheck)
                    if (nonExistUsers.length > 0) {
                        throw new ctx.err({message: "NOT_AUTHORIZED", data: {viewer_id: nonExistUsers}})
                    }
                }
                
                //3. add/mod fields
                update_fields['updateDateTime'] = moment().toDate()
                
                //4. query & return
                //Fixme also insert manager/viewer into User doc
                
                const doc = await ctx.db['p001'].collection('Account').findOneAndUpdate({_id: id }, {$set: update_fields}, {returnOriginal: false})
                
                return doc.value
            } catch(e) { throw e }
        },
        updateAccountOwner: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isAdmin(ctx)
                ctx.spFunction['p001'].convertArgs(args)
                //2. field checking
                
                const userCheck = await ctx.db['p001'].collection('User').findOne({_id: args.owner_id}, {projection:{_id: 1}})
                if (userCheck==null) {
                    throw new ctx.err({message: "INVALID", data: {owner_id: args.owner_id}})
                }
                //3. add/mod fields
                //4. query & return
                //Fixme also insert owner into User doc
                const doc = await ctx.db['p001'].collection('Account').findOneAndUpdate({_id: args._id }, {$set:{owner_id: args.owner_id, updateDateTime: moment().toDate()}}, {returnOriginal: false})
                return doc.value
            } catch(e) { throw e }
        },
        updateAccountType: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isAdmin(ctx)
                ctx.spFunction['p001'].convertArgs(args)
                //2. field checking
                //3. add/mod fields
                //4. query & return
                const doc = await ctx.db['p001'].collection('Account').findOneAndUpdate({_id: args._id }, {$set:{accountType: args.accountType, updateDateTime: moment().toDate()}}, {returnOriginal: false})
                return doc.value
            } catch(e) { throw e }
        },
        addStripeSource: async (obj, args, ctx, info) => {
            try {
                const a = await addStripeSource(ctx, args.token, undefined, args.account_id)
                console.log(a)
                return a
            } catch(e) { throw e }
        },
        removeStripeSource: async (obj, args, ctx, info) => {
            try {
                ctx.spFunction['p001'].convertArgs(args)
                isAcctOwner(ctx, args.account_id)
                
                let acct = await ctx.db['p001'].collection('Account').find({_id: args.account_id}, {_id: 1, stripeCustomerObject: 1}).limit(1).toArray()
                
                if (acct.length<1) { throw new Error('account_id not found') }
                acct = acct[0]
                
                let cusObj = acct.stripeCustomerObject
                let newCusObj
                
                console.log('removeStripeSource, cusObj=', acct)
                try {
                    //call Stripe delete source
                    const deletedSource = await stripe.customers.deleteSource(cusObj.id, args.token)
                    console.log('deleted source=', deletedSource)
                    
                    //retrieve customer object again from Stripe
                    newCusObj = await stripe.customers.retrieve(cusObj.id)
                    console.log('new cus=', newCusObj)
                }
                catch(e) { 
                    console.log(e)
                    throw new Error('Stripe error:', )
                    
                }
                    
                const doc = await ctx.db['p001'].collection('Account').findOneAndUpdate({_id: args.account_id }, {$set: {stripeCustomerObject: newCusObj}} , {returnOriginal: false})
                    
                return doc.value
            } catch(e) { throw e }
        }
    },
    Account: {
        stripeCustomerObject: async (obj, args, ctx, info) => {
            return JSON.stringify(obj.stripeCustomerObject)
        }
    },
    Address: {
        account_id: async (obj, args, ctx, info) => {
            try {
                const a = await ctx.db['p001'].collection('Account').findOne({_id: obj.account_id})
                return a
            } catch(e) { throw e }
        }
    },
    User: {
        accountView_id: async (obj, args, ctx, info) => {
            try {
                if (obj.accountView_id==null) { return null }
                const doc = await ctx.db['p001'].collection('Account').find({_id: {$in: obj.accountView_id}}).toArray()
                return doc
            } catch(e) { throw e }
        },
        accountManage_id: async (obj, args, ctx, info) => {
            try {
                if (obj.accountManage_id==null) { return null }
                const doc = await ctx.db['p001'].collection('Account').find({_id: {$in: obj.accountManage_id}}).toArray()
                return doc
            } catch(e) { throw e }
        },
        accountOwn_id: async (obj, args, ctx, info) => {
            try {
                console.log('Account.User.accountOwn_id resolver', obj.accountOwn_id)
                if (obj.accountOwn_id==null) { return null }
                const doc = await ctx.db['p001'].collection('Account').find({_id: {$in: obj.accountOwn_id}}).toArray()
                return doc
            } catch(e) { throw e }
        }
    },
    Container: {
        accountOwner_id: async (obj, args, ctx, info) => {
            try {
                const doc = await ctx.db['p001'].collection('Account').findOne({_id: obj.accountOwner_id})
                return doc
            } catch(e) { throw e }
        },
    },
    Quotation: {
        account_id: async (obj, args, ctx, info) => {
            try {
                const doc = await ctx.db['p001'].collection('Account').findOne({_id: obj.account_id})
                return doc
            } catch(e) { throw e }
        },
    },
    RentalOrder: {
        account_id: async (obj, args, ctx, info) => {
            try {
                if (_.get(info, 'operation.name.value') == 'getRecentROListByUser') { return {_id: obj.account_id}}
                const doc = await ctx.db['p001'].collection('Account').findOne({_id: obj.account_id})
                return doc
            } catch(e) { throw e }
        },
    }
}

export const typeDefPublic = `
    type Account {
        _id: ID,
    }`
    
export const resolverPublic = {
    Quotation: {
        account_id: (obj, args, ctx, info) => { return '' },
    },
}


const getUpdateField = (op, fields) => {
    switch(op) {
        case 'SET': return {$set: fields}
        case 'INC': return {$inc: fields}
        case 'UNSET': return {$unset: fields}
        default: throw new Error('updateOp does not support this Operator: ' + op)
    }
}

