import _ from 'lodash'
import moment from 'moment'
import ver from 'validator'
import { isAcctOwnerManager, isActiveUser, isTargetUserOrStaff, isAdminOrSU }  from '../auth/auth.mjs'

export const addressType = ['WHS', 'CUSTOMER']

export const typeDef = `
    
    enum addressType {
        WHS
        CUSTOMER
    }
    
    extend type Query {
        "Use by staff (Admin/SU)"
        getAddress(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [Address]
        
        "Same as getAddress but can be used by all active users.  Will auto fill/override account_id with active logined user"
        getAddressByUser(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [Address]
    }
    
    extend type Mutation {
        addAddress(legalName: String!, addressCountry: String!, addressRegion1: String, streetAddress: String!, telephone: String!, account_id: String!, addressRegion2: String!, addressType: String!, setDefaultBilling: Boolean, setDefaultShipping: Boolean): Address
        
        updateAddress(_id: String!, account_id: String!, legalName: String, addressCountry: String, addressRegion1: String, addressRegion2: String, streetAddress: String, telephone: String, isActive: Boolean, setDefaultBilling: Boolean, setDefaultShipping: Boolean): Address
    }
    
    type Address {
        _id: ID!,
        addressType: String,
        legalName: String,
        addressCountry: String!,
        addressRegion1: String,
        addressRegion2: String!,
        streetAddress: String!,
        telephone: String,
        isActive: Boolean!,
        
        "an ID of an Account that owns this Address"
        account_id: Account!,
        
        creationDateTime: GraphQLDateTime,
        updateDateTime: GraphQLDateTime
    }
    
    type addressSnapShot {
        legalName: String,
        addressCountry: String,
        addressRegion1: String,
        addressRegion2: String,
        streetAddress: String,
        telephone: String
    }
    `
    
//1. check for access requirement
//2. field checking
//3. add/mod fields
//4. query & return

export const resolver = {
    Query: {
        getAddress: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                ctx.spFunction['p001'].convertArgs(args)
                isAdminOrSU(ctx)
                //2. field checking
                //3. add/mod fields
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('Address'), args)
                const doc =  await q.toArray()
                //4. query & return
                return doc
            } catch(e) { throw e }
        },
        getAddressByUser: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                ctx.spFunction['p001'].convertArgs(args)
                isActiveUser(ctx)
                //2. field checking
                //3. add/mod fields
                args['account_id'] = ctx.req.user._id
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('Address'), args)
                const doc =  await q.toArray()
                //4. query & return
                return doc
            } catch(e) { throw e }
        }
    },
    Mutation: {
        addAddress: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                //2. field checking
                console.log('addAddress')
                ctx.spFunction['p001'].convertArgs(args)
                
                let insert_args = {}
                
                const acctCheck = await ctx.db['p001'].collection('Account').findOne({_id: args.account_id}, {projection:{_id: 1, owner_id: 1, manager_id: 1, defaultBillingAddress_id: 1, defaultShippingAddress_id: 1}})
                if (!acctCheck) {
                    throw new ctx.err({message: "INVALID", data: {account_id: args.account_id}})
                }
                
                isTargetUserOrStaff(ctx, _.compact(_.union([acctCheck.owner_id], acctCheck.manager_id)))
                
                if (args['legalName'].length < 1) { throw new ctx.err({message: "INVALID", data: {legalName: args.legalName}}) }
                if (args['addressCountry'].length < 1) { throw new ctx.err({message: "INVALID", data: {addressCountry: args.addressCountry}}) }
                if ((args['streetAddress'].length < 5) || (args['streetAddress'].length > 500)) { throw new ctx.err({message: "INVALID", data: {streetAddress: args.streetAddress}}) }
                if (args['addressRegion2'].length < 1) { throw new ctx.err({message: "INVALID", data: {addressRegion2: args.addressRegion2}}) }
                if (args['telephone'].length < 8) { throw new ctx.err({message: "INVALID", data: {telephone: args.telephone}}) }
                
                insert_args = _.pick(args, ['legalName','addressCountry', 'streetAddress', 'addressRegion1', 'addressRegion2', 'telephone'])
                
                
                //3. add/mod fields
                insert_args['isActive'] = true
                insert_args['addressType'] = 'CUSTOMER' //not taking input from user, and hardcode to CUSTOMER
                insert_args['creationDateTime'] = moment().toDate()
                insert_args['updateDateTime'] = insert_args['creationDateTime']
                //4. query & return
                
                //First, insert the address and get it's object
                const a = await ctx.db['p001'].collection('Address').insertOne(insert_args);
                console.log('addAddress, address added=', a.ops[0])
                const newAddress_id = a.ops[0]._id
                
                //Set variables to update Account object, add this new address to address_id
                let update_args = {$push: {address_id: newAddress_id } }
                let updateDefaultAddress = {}
                
                //if user ask for set as default, or if default is null (means no default address yet), set this new address as default
                if (acctCheck.defaultBillingAddress_id==null || args['setDefaultBilling']) { updateDefaultAddress['defaultBillingAddress_id'] = newAddress_id }
                
                if (acctCheck.defaultShippingAddress_id==null || args['setDefaultShipping']) { updateDefaultAddress['defaultShippingAddress_id'] = newAddress_id }
                
                if (updateDefaultAddress!= {}) { Object.assign({$set: updateDefaultAddress}, insert_args) }
                
                //Update Account with new info
                const b = await ctx.db['p001'].collection('Account').findOneAndUpdate({_id: args.account_id}, insert_args, {returnOriginal:false})
                
                console.log('addAddress, Account updated=', b)
                return a.ops[0]
            } catch(e) { throw e }
        },
        updateAddress: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                console.log('updateAddress')
                ctx.spFunction['p001'].convertArgs(args)

                //2. field checking
                const id = args._id
                const update_fields = _.omit(args, ['_id', 'account_id', 'setDefaultBilling', 'setDefaultShipping'])
                if (_.isEmpty(update_fields)) {
                    throw new ctx.err({message: "NO_FIELDS_TO_UPDATE", data: {} })
                }
                
                //check if user has access right to update the addres
                const address = await ctx.db['p001'].collection('Address').findOne({_id: id}, {projection: {account_id: 1, isActive: 1}} )
                console.log('updateAddress, address=',address, 'args=', args)
                isAcctOwnerManager(ctx, address.account_id)
                
                if (args['legalName'] && (args['legalName'].length < 1)) { throw new ctx.err({message: "INVALID", data: {legalName: args.legalName}}) }
                
                if (args['addressCountry'] && (args['addressCountry'].length < 1)) { throw new ctx.err({message: "INVALID", data: {addressCountry: args.addressCountry}}) }
                
                if (args['streetAddress'] && ((args['streetAddress'].length < 5) || (args['streetAddress'].length > 500)) ) { 
                    throw new ctx.err({message: "INVALID", data: {streetAddress: args.streetAddress}})
                }
                
                //if (args['addressRegion1'] && (args['addressRegion1'].length < 1)) { throw new ctx.err({message: "INVALID", data: {addressRegion2: args.addressRegion2}}) }
                
                if (args['addressRegion2'] && (args['addressRegion2'].length < 1)) { throw new ctx.err({message: "INVALID", data: {addressRegion2: args.addressRegion2}}) }
                
                if (args['telephone'] && (args['telephone'].length != 8)) { throw new ctx.err({message: "INVALID", data: {telephone: args.telephone}}) }
                
                
                
                //3. add/mod fields
                update_fields['updateDateTime'] = moment().toDate()
                //4. query & return
                
                const account = await ctx.db['p001'].collection('Account').findOne({_id: address.account_id}, {projection: {address_id: 1, defaultBillingAddress_id: 1, defaultShippingAddress_id: 1}} )
                
                if (args['isActive']==false && address.isActive==true) { //means user is disabling it
                    console.log('disabling address', id)
                    
                    if (account.address_id.length<=1) { throw new ctx.err({message: "CANNOT_DISABLE_LAST_ONE", data: {address: 1}}) }  //last one cannot be disabled, throw error.  This is special key is not 'isActive' but change to 'address', so front-end can properly show err message.
                    
                    const address_id = account.address_id.filter((v)=> !v.equals(id) )
                    
                    //if this disabled address is a default address, put the first address in account's address list as default
                    const defaultBillingId = (id.equals(account.defaultBillingAddress_id)) ? address_id[0] : account.defaultBillingAddress_id
                    const defaultShippingId = (id.equals(account.defaultShippingAddress_id)) ? address_id[0] : account.defaultShippingAddress_id
                    
                    const a = await ctx.db['p001'].collection('Account').findOneAndUpdate({_id: account._id }, {$set: {address_id: address_id, defaultShippingAddress_id: defaultShippingId, defaultBillingAddress_id: defaultBillingId }}, {returnOriginal: false})
                }
                
                if (args['isActive']==true && address.isActive==false) { //means user is enabling it  //this part is not tested
                    console.log('enabling address, ', id)

                    const address_id = account.address_id.concat([id])
                    
                    const a = await ctx.db['p001'].collection('Account').findOneAndUpdate({_id: account._id }, {$set: {address_id: address_id }}, {returnOriginal: false})
                }
                
                const doc = await ctx.db['p001'].collection('Address').findOneAndUpdate({_id: id }, getUpdateField('SET', update_fields), {returnOriginal: false})
                
                console.log('updated address=', doc.value)
                
                //if user ask for set as default, or if default is null (means no default address yet), set this new address as default
                let updateDefaultAddress = {}
                if (args['setDefaultBilling']) { updateDefaultAddress['defaultBillingAddress_id'] = address._id }
                
                if (args['setDefaultShipping']) { updateDefaultAddress['defaultShippingAddress_id'] = address._id }
                
                console.log('updateDefaultAddress=', updateDefaultAddress)
                //If there are changes, update Account with new info
                if (updateDefaultAddress!= {}) {
                    const b = await ctx.db['p001'].collection('Account').findOneAndUpdate({_id: address.account_id}, {$set: updateDefaultAddress}, {returnOriginal:false})
                }
                
                //return address
                return doc.value
            } catch(e) { throw e }
        }
    },
    Account: {
        address_id: async (obj, args, ctx, info) => {
            try {
                if (obj.address_id===undefined) { return undefined }
                let addressArray = []
                for (let i=0;i<obj.address_id.length;i++) {
                    addressArray.push(ctx.spFunction['p001'].getIdObj(obj.address_id[i]))
                }
                const docs = await ctx.db['p001'].collection('Address').find({_id: {$in: addressArray}}).toArray()
                return docs
            } catch(e) { throw e }
        },
        defaultShippingAddress_id: async (obj, args, ctx, info) => {
            try {
                if (obj.defaultShippingAddress_id===undefined) { return undefined }
                const a = {_id: obj.defaultShippingAddress_id}
                ctx.spFunction['p001'].convertArgs(a)
                const doc = await ctx.db['p001'].collection('Address').findOne(a)
                return doc
            } catch(e) { throw e }
        },
        defaultBillingAddress_id: async (obj, args, ctx, info) => {
            try {
                if (obj.defaultBillingAddress_id===undefined) { return undefined }
                const a = {_id: obj.defaultBillingAddress_id}
                ctx.spFunction['p001'].convertArgs(a)
                const doc = await ctx.db['p001'].collection('Address').findOne(a)
                return doc
            } catch(e) { throw e }
        }
    }
}

const getUpdateField = (op, fields) => {
    switch(op) {
        case 'SET': return {$set: fields}
        case 'INC': return {$inc: fields}
        case 'UNSET': return {$unset: fields}
        default: throw new Error('updateOp does not support this Operator: ' + op)
    }
}