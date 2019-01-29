import _ from 'lodash'
import moment from 'moment'
import bcrypt from 'bcryptjs'
import ver from 'validator'
import { authUserLocal, checkRole, checkRoleOR, staffRoleList, roleList, isStaff, isTargetUser, isAdminOrSU, isTargetUserOrStaff }  from '../auth/auth.mjs'
import { getIdObj } from '../db/p001.mjs'

import {addAccountForNewUser} from './Account.mjs'


import sendMail from '../util/sendMail.mjs'
import {genPassword} from '../util/util.mjs'

import twilio from 'twilio'

const sendPINBySMS = async ({mobilePhone, PIN, deadline, uid, lang}) => {
    console.log('send code by SMS', PIN, mobilePhone)
    const smsClient = new twilio(process.env.TWILIO_ACCT_SID, process.env.TWILIO_AUTH_TOKEN)
    
    const m = await smsClient.messages.create({
        from: '+16093015332',
        to: '+85261293993',
        body: 'PIN= '+ PIN
    })
    console.log(m)
    return new Promise(resolve=> resolve(m))
}

const sendPINByEmail = ({email, PIN, deadline, uid, lang}) => {
    sendMail('sendVerificationPIN', {
        to: email,
        verificationPIN: PIN,
        verifyDeadline: deadline,
        uid: uid
    })
}



const addUser= async (obj, args, ctx, info) => {
    try {
        //1. check for access requirement
        //2. field checking
        if (!ver.isEmail(args.email)) {
            throw new ctx.err({message: "INVALID", data: {email: args.email}})
        }
        
        let checkDup = await ctx.db['p001'].collection('User').findOne({email: args.email })
        if (! (checkDup==null)) {
            throw new ctx.err({message: "KEY_EXIST", data: {email: args.email}})
        }
        
        //Fixme if email exist, either re-activate or contact staff or ask to login
        const pw_regexp = new RegExp(/^(?=.*[a-z])(?=.*[A-Z])(?=.*[a-zA-Z]).{8,}$/)
        if (!pw_regexp.test(args.password)) {
            throw new ctx.err({message: "PASSWORD_TOO_SIMPLE", data: {password: args.password}})
        }

        if (!ver.isMobilePhone(args.mobilePhone, 'en-HK')) {
            throw new ctx.err({message: "INVALID", data: {mobilePhone: args.mobilePhone}})
        }
        checkDup = await ctx.db['p001'].collection('User').findOne({mobilePhone: args.mobilePhone })
        if (! (checkDup==null)) {
            throw new ctx.err({message: "KEY_EXIST", data: {mobilePhone: args.mobilePhone}})
        }
        
        //3. add/mod fields
        args['isActive'] = false
        args['role'] = ['USER']
        args['creationDateTime'] = moment().toDate()
        args['updateDateTime'] = args['creationDateTime']
        args['createThru'] = 'test' //#2 Fixme, should get this from API, args or whatever
        args['password'] = await bcrypt.hash(args['password'], 10)
        args['verificationPIN'] = ("000000" + Math.round(Math.random() * 999999).toString()).substr(-6,6)
        args['verifyDeadline'] = moment().add(1,'d').toDate()
        args['verifiedContactMethod'] = (args['verifyBySMS']===true) ? 'SMS': 'Email'
        args['language'] = (args['language'].length > 2) ? (args['language'].slice(0, 2) + '-' + args['language'].slice(2)) : args['language']
        args['accountOwn_id'] = []
        args['accountManage_id'] = []
        args['accountView_id'] = []
        //4. query & return
        let a = await ctx.db['p001'].collection('User').insertOne(args);
        
        const newAcct = await addAccountForNewUser(ctx, 'PERSONAL', a.ops[0]._id)
        a = await ctx.db['p001'].collection('User').findOneAndUpdate(
            {_id: a.ops[0]._id},
            {
                $push: {accountOwn_id: newAcct._id},
            },
            {returnOriginal: false}
        )
        console.log('update user success: ', a)
        //send email for verification code
        if (args['verifyBySMS']===true) {
            const b = await sendPINBySMS({
                mobilePhone: a.value.mobilePhone,
                PIN: a.value.verificationPIN,
                deadline: a.value.verifyDeadline,
                uid: a.value._id,
                lang: args.language
            })
            console.log(b)
        }
        else {
            sendPINByEmail({
                email: a.value.email,
                PIN: a.value.verificationPIN,
                deadline: a.value.verifyDeadline,
                uid: a.value._id,
                lang: args.language
            })
        }
        
        return a.value
    } catch(e) { throw e }
}

const verifyNewUser = async (obj, args, ctx, info) => {
    try {
        //1. check for access requirement
        //2. field checking
        ctx.spFunction['p001'].convertArgs(args)
        let doc = await ctx.db['p001'].collection('User').findOne({_id: args._id})
        
        if (doc==null) {
            throw new ctx.err({message: "NOT_FOUND", data: {_id: args._id}})
        }
        if (doc.isActive) {
            throw new ctx.err({message: "USER_ALREADY_ACTIVATED"})
        }
        if (doc.verificationPIN == undefined) {
            throw new ctx.err({message: "SUSPENDED"})
        }
        if (moment().isAfter(doc.verifyDeadline)) {
            throw new ctx.err({message: "EXPIRED", data: {verificationPIN: ''}})
        }
        if (doc.verificationPIN != args.verificationPIN) {
            throw new ctx.err({message: "INVALID", data: {verificationPIN: args.verificationPIN}})
        }
        //3. add/mod fields
        //4. query & return
        const updatedDoc = await ctx.db['p001'].collection('User').findOneAndUpdate(
            {_id: args._id},
            {
                $set: {isActive: true, updateDateTime: moment().toDate()},
                $unset: {verificationPIN: "", verifyDeadline: ""}
            },
            {returnOriginal: false}
        )
        console.log('doc=', doc)
        console.log('updatedDoc', updatedDoc)
        const a = await ctx.db['p001'].collection('Account').findOneAndUpdate(
            {_id: doc.accountOwn_id[0]},
            {
                $set: {isActive: true},
            },
            {returnOriginal: false}
        )
        console.log('a=', a)
        return updatedDoc.value
    } catch(e) { throw e }
}

const resendVerification = async (obj, args, ctx, info) => {
    try {
        //1. check for access requirement
        console.log('resolver.User.resendVerification')
        ctx.spFunction['p001'].convertArgs(args)
        let doc = await ctx.db['p001'].collection('User').findOne({_id: args._id})

        //2. field checking
        if (doc==null) {
            throw new ctx.err({message: "NOT_FOUND", data: {_id: args._id}})
        }
        if (doc.isActive) {
            throw new ctx.err({message: "USER_ALREADY_ACTIVATED"})
        }
        if (doc.verificationPIN == undefined) {
            throw new ctx.err({message: "SUSPENDED"})
        }
        //3. add/mod fields
        args['updateDateTime'] = moment().toDate()
        args['verificationPIN'] = ("000000" + Math.round(Math.random() * 999999).toString()).substr(-6,6)
        args['verifyDeadline'] = moment().add(1,'d').toDate()
        args['verifiedContactMethod'] = (args['verifyBySMS']===true) ? 'SMS': 'Email'
        const id = args._id
        let update_fields = _.omit(args, '_id')
        //4. query & return
        let {value} = await ctx.db['p001'].collection('User').findOneAndUpdate({_id: args._id }, getUpdateField('SET', update_fields), {returnOriginal: false})
        console.log('doc after updated PIN=', value)
        //send email for verification code
        //4. query & return
        if (args['verifyBySMS']===true) {
            const b = await sendPINBySMS({
                mobilePhone: value.mobilePhone,
                PIN: value.verificationPIN,
                deadline: value.verifyDeadline,
                uid: value._id,
                lang: value.language
            })
            console.log(b)
        }
        else {
            sendPINByEmail({
                email: value.email,
                PIN: value.verificationPIN,
                deadline: value.verifyDeadline,
                uid: value._id,
                lang: value.language
            })
        }
        return value
    } catch(e) { throw e }
}

const resetPassword = async (obj, args, ctx, info) => {
    try {
        //1. check for access requirement
        console.log('resetPassword for ', args)
        ctx.spFunction['p001'].convertArgs(args)
        let doc = await ctx.db['p001'].collection('User').findOne({$or: [{email: args.login}, {mobilePhone: args.login}]})

        //2. field checking
        if (doc==null) {
            throw new ctx.err({message: "NOT_FOUND", data: {login: args.login}})
        }
        if (!doc.isActive) {
            throw new ctx.err({message: "SUSPENDED"})
        }

        //3. add/mod fields
        const password = genPassword()
        const update_fields = {}
        update_fields['password'] = await bcrypt.hash(password, 10)
        update_fields['updateDateTime'] = moment().toDate()

        //4. query & return
        let {value} = await ctx.db['p001'].collection('User').findOneAndUpdate({_id: doc._id }, getUpdateField('SET', update_fields), {returnOriginal: false})
        //send email for verification code
        if (doc.verifyBySMS===true) {
            console.log('send code by SMS', password, doc.mobilePhone)
        }
        else {
            sendMail('sendVerificationPIN', {
                to: doc.email,
                verificationPIN: password,
                verifyDeadline: moment().toDate(),
                uid: args._id
            })
        }
        console.log(doc)
        return doc
    } catch(e) { 
        console.log(e)
        throw e }
}


//Custom schema
export const typeDef = `
    
    extend type Query {
        "get a list of user, role=staff.  User use getUserById"
        getUser(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [User]
        
        "get a single user, by id.  Need to be the user itself.  Staff access use getUser instead"
        getUserById(_id: String!): User
        
        "get the logined user itself"
        getMyself: User
        
        "to be removed"
        userAuth(email: String!, password: String!): Boolean!
    }
    
    extend type Mutation {
        
        addUser(firstName: String!, lastName: String!, email: String!, mobilePhone: String!, password: String!, createThru: String!, verifyBySMS: Boolean!, language: Language!): User

        "For user to update their own info."
        updateUserDetails(firstName: String, lastName: String, existingPassword: String, newPassword: String): User
        updateUserRole(_id: String!, role: [userRoleType!]!): User
        
        updateUserEmailPhone(_id: String!, email: String, mobilePhone: String): User
        updateAccountRelation(_id: String!, accountView_id: [String!], accountManage_id: [String!], accountOwn_id: [String!]): User
        
        "For admint to reset password for users, return new password in String (Fixme to change to return user object and email user instead"
        updateUserPasswordAdmin(_id: String!): String
        
        resendVerification(_id: String!, verifyBySMS: Boolean!): User
    }
    
    type User {
        _id: ID!,
        firstName: String!,
        lastName: String!,
        
        "this field only available after accout has been created, or when email/mobile phone number changed."
        verificationPIN: String,
        
        "this field only available after accout has been created, or when email/mobile phone number changed."
        verifyDeadline: GraphQLDateTime,
        
        verifiedContactMethod: String,
        
        email: String!,
        
        "only accept HK mobile phone numbers"
        mobilePhone: String!,
        
        "at least 8 chars, at least 1 letter, at least 1 number"
        password: String!,
        role: [userRoleType]!,
        
        verifyBySMS: Boolean!,
        language: String!,
        
        "array of ID"
        accountView_id: [Account],
        
        "array of ID"
        accountManage_id: [Account],
        
        "array of ID"
        accountOwn_id: [Account],
        isActive: Boolean!,
        creationDateTime: GraphQLDateTime,
        createThru: String,
        updateDateTime: GraphQLDateTime
        
    }`
    
export const resolver = {
    Query: {
        getUser: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                console.log('ctx=',ctx.req.user)
                isStaff(ctx)
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('User'), args)
                //4. query & return
                const a = await q.toArray()
                return a
            } catch(e) { throw e }
        },
        getUserById: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isTargetUser(ctx, args._id)
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                //4. query & return
                const doc = await ctx.db['p001'].collection('User').findOne({_id: args._id })
                return doc
            } catch(e) { throw e }
        },
        getMyself: async (obj, args, ctx, info) => {
            console.log('getMyself')
            return ctx.req.user
        },

        userAuth: async (obj, args, ctx, info) => { //Fixme to remove this as login should happen using express session
            try { 
                const a = await authUserLocal(args.email, args.password)
                return true
            } catch(e) {
                console.log(e)
                return false
            }
            
        }
    },
    Mutation: {
        addUser: addUser,
        updateUserDetails: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                if (_.isEmpty(args)) {
                    throw new ctx.err({message: "NO_FIELDS_TO_UPDATE", data: {} })
                }
                
                const user = await ctx.db['p001'].collection('User').findOne({_id: getIdObj(ctx.req.user._id) })
                if ( !(ctx.req.isAuthenticated() & (user.isActive==true)) ) {
                    throw new ctx.err({message: "NOT_AUTHORIZED"})
                }
                
                //2. field checking
                ctx.spFunction['p001'].convertArgs(args)
                let update_fields = args
                //change password if both new and existing password is provided and passed test
                if (args.newPassword) {
                    if (args.existingPassword == undefined) {
                        throw new ctx.err({message: "INVALID", data: {existingPassword: ''}})
                    }
                    const pw_ok = await bcrypt.compare(args.existingPassword, user.password)
                    if (!pw_ok) { throw new ctx.err({message: "PASSWORD_NOT_MATCH"}) }
                    
                    update_fields['password'] = await bcrypt.hash(args['newPassword'], 10)
                    update_fields = _.omit(_.omit(update_fields, 'existingPassword'), 'newPassword')
                }
                
                if (args['firstName'] && (args['firstName'].length < 1)) { 
                    throw new ctx.err({message: "INVALID", data: {firstName: args.firstName}})
                }
                if (args['lastName'] && (args['lastName'].length < 1)) { 
                    throw new ctx.err({message: "INVALID", data: {lastName: args.lastName}})
                }
                
                //3. add/mod fields
                update_fields['updateDateTime'] = moment().toDate()
                
                //4. query & return
                const doc = await ctx.db['p001'].collection('User').findOneAndUpdate({_id: user._id }, getUpdateField("SET", update_fields), {returnOriginal: false})
                return doc.value
            } catch(e) { throw e }
        },
        updateUserRole: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isAdminOrSU(ctx)
                //2. field checking
                ctx.spFunction['p001'].convertArgs(args)
                const u = await ctx.db['p001'].collection('User').findOne({_id: args._id })
                if (u==null) {
                    throw new ctx.err({message: "NOT_AUTHORIZED"})
                }
                if (checkRole(u, 'SU')) { //can do anything.
                
                } else { //if not su
                    if (checkRoleOR(u, staffRoleList)) { //if target user is a staff, cannot make changes, i.e. changing staff role must need su
                        throw new ctx.err({message: "NOT_AUTHORIZED"})
                    }
                }
                //Fixme 'admin' can only add roles in customerRoleList, or cannot touch staff accounts
                const roleDiff = _.difference(args.role, roleList)
                if (roleDiff.length > 0) {
                    throw new ctx.err({message: "INVALID", data: {role: roleDiff}})
                }
                //3. add/mod fields
                args['updateDateTime'] = moment().toDate()
                //4. query & return
                const doc = await ctx.db['p001'].collection('User').findOneAndUpdate({_id: args._id }, {$set: {role:args.role}}, {returnOriginal: false})
                return doc.value
            } catch(e) { throw e }
        },
        updateUserEmailPhone: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isTargetUserOrStaff(ctx, args._id)
                //2. field checking
                let args_ok = false
                let updateParam = {}
                if (args.email) {
                    args_ok = true
                    if (!ver.isEmail(args.email)) {
                        throw new ctx.err({message: "INVALID", data: {email: args.email}})
                    }
                    let checkDup = await ctx.db['p001'].collection('User').findOne({email: args.email })
                    if (! (checkDup==null)) {
                        throw new ctx.err({message: "KEY_EXIST", data: {email: args.email}})
                    }
                    updateParam['email'] = args.email
                }
                if (args.mobilePhone) {
                    args_ok = true
                    if (!ver.isMobilePhone(args.mobilePhone, 'en-HK')) {
                        throw new ctx.err({message: "INVALID", data: {mobilePhone: args.mobilePhone}})
                    }
                    let checkDup = await ctx.db['p001'].collection('User').findOne({mobilePhone: args.mobilePhone })
                    if (! (checkDup==null)) {
                        throw new ctx.err({message: "KEY_EXIST", data: {mobilePhone: args.mobilePhone}})
                    }
                    updateParam['mobilePhone'] = args.mobilePhone
                }
                if (!args_ok) {  throw new ctx.err({message: "NO_FIELDS_TO_UPDATE", data: { }}) }
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                updateParam['updateDateTime'] = moment().toDate()
                //4. query & return
                const doc = await ctx.db['p001'].collection('User').findOneAndUpdate({_id: args._id }, {$set: updateParam}, {returnOriginal: false})
                return doc.value
            } catch(e) { throw e }
        },
        updateAccountRelation: async (obj, args, ctx, info) => {
            //Fixme
        },
        updateUserPasswordAdmin: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isStaff(ctx)
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                const newPw = Math.random().toString(36).slice(-8)
                
                args['password'] = await bcrypt.hash(newPw, 10)
                const doc = await ctx.db['p001'].collection('User').findOneAndUpdate({_id: args._id }, {$set: {password: args.password, updateDateTime: moment().toDate()}}, {returnOriginal: false})
                return newPw
                //4. query & return
            } catch(e) { throw e }
        },
        resendVerification: resendVerification
        
    },
    User: {
        password: () => {return 'hidden'},
        verificationPIN: async (obj) => {
            if (obj.verificationPIN==undefined) { return undefined }
            else { return 'hidden' }
        }
    },
    Account: {
        owner_id: async (obj, args, ctx, info) => {
            try {
                const doc = await ctx.db['p001'].collection('User').findOne({_id: obj.owner_id})
                return doc
            } catch(e) { throw e }
        },
        manager_id: async (obj, args, ctx, info) => {
            try {
                if (!obj.manager_id) { return undefined }
                const doc = await ctx.db['p001'].collection('User').find({_id: {$in: obj.manager_id}}).toArray()
                return doc
            } catch(e) { throw e }
        },
        viewer_id: async (obj, args, ctx, info) => {
            try {
                if (!obj.viewer_id) { return undefined }
                const doc = await ctx.db['p001'].collection('User').find({_id: {$in: obj.viewer_id}}).toArray()
                return doc
            } catch(e) { throw e }
        }
    },
    Quotation : {
        createBy_id: async (obj, args, ctx, info) => {
            try {
                if (!obj.createBy_id) { return undefined }
                const doc = await ctx.db['p001'].collection('User').findOne({_id: obj.createBy_id})
                return doc
            } catch(e) { throw e }
        },
        updateBy_id: async (obj, args, ctx, info) => {
            try {
                if (!obj.updateBy_id) { return undefined }
                const doc = await ctx.db['p001'].collection('User').findOne({_id: obj.updateBy_id})
                return doc
            } catch(e) { throw e }
        }
    },
    RentalOrder : {
        createBy_id: async (obj, args, ctx, info) => {
            try {
                if (_.get(info, 'operation.name.value') == 'getRecentROListByUser') { return {_id: obj.createBy_id}}
                const doc = await ctx.db['p001'].collection('User').findOne({_id: obj.createBy_id})
                return doc
            } catch(e) { throw e }
        },
        updateBy_id: async (obj, args, ctx, info) => {
            try {
                if (_.get(info, 'operation.name.value') == 'getRecentROListByUser') { return {_id: obj.updateBy_id}}
                const doc = await ctx.db['p001'].collection('User').findOne({_id: obj.updateBy_id})
                return doc
            } catch(e) { throw e }
        }
    }
}

export const typeDefPublic = `


    extend type Query {
        "If return false, means already have record.  True means can proceed to signup"
        checkEmail(email: String!): Boolean
        
        "If return false, means already have record.  True means can proceed to signup"
        checkPhone(mobilePhone: String!): Boolean
    }
    extend type Mutation {
        addUser(firstName: String!, lastName: String!, email: String!, mobilePhone: String!, password: String!, createThru: String!, verifyBySMS: Boolean!, language: Language!): User
        
        "Given id and verification PIN, activate a user.  Successful will remove the field verificationPIN from user profile and isActive=true, return User object.  Fail will return false"
        verifyNewUser(_id: String!, verificationPIN: String!): User
        
        resendVerification(_id: String!, verifyBySMS: Boolean!): User
        resetPassword(login: String!): User
    }
    
    type User {
        _id: ID!,
        firstName: String!,
        lastName: String!,
        
        "this field only available after accout has been created, or when email/mobile phone number changed."
        verifyDeadline: GraphQLDateTime,
        
        verifiedContactMethod: String,
        
        email: String!,
        
        "only accept HK mobile phone numbers"
        mobilePhone: String!,
        
        role: [userRoleType]!,
        
        verifyBySMS: Boolean!,
        language: String!,

        isActive: Boolean!,
        creationDateTime: GraphQLDateTime,
        createThru: String,
        updateDateTime: GraphQLDateTime
        
    }`

export const resolverPublic = {
    Query: {
        checkEmail: async (obj, args, ctx, info) => {
            const count = await ctx.db['p001'].collection('User').find({email: args['email']}).limit(1).count()
            console.log(count)
            return (count > 0) ? false: true
        },
        checkPhone: async (obj, args, ctx, info) => {
            const count = await ctx.db['p001'].collection('User').find({email: args['mobilePhone']}).limit(1).count()
            console.log(count)
            return (count > 0) ? false: true
        }
    },
    Mutation: {
        addUser: addUser,
        verifyNewUser: verifyNewUser,
        resendVerification: resendVerification,
        resetPassword: resetPassword
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