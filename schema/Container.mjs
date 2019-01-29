import _ from 'lodash'
import moment from 'moment'
import { isAcctOwnerManager, isAcctOwnerManagerViewer} from '../auth/auth.mjs'

export const addContainersFromDocLine = async (ctx, docLine, acct_id, RO_id) => {
    //addContainers will create a bunch of containers from a single docLine from RentalOrder
    try {
        //1. check for access requirement
        //2. field checking
        const {SKU_id, rentMode, duration, qty} = docLine
        
        //get SKU from SKU_id in docLine, prepare to populate Container
        let SKU = await ctx.db['p001'].collection('SKUMaster').find(
            {
                _id: ctx.spFunction['p001'].getIdObj(SKU_id),
                isActive: true
            }, {shortCode: 1, name: 1, lengthM:1, widthM:1, heightM:1}
        ).toArray()
        
        if (SKU.length < 1) { throw new ctx.err( {message: "SPECIAL", data: {msg: 'SKU not found, SKU_id: ' + docLine.SKU_id}} )
        }
        SKU = SKU[0]
        
        
        
        //3. add/mod fields
        
        
        let containers = []
        for (let i=0;i<qty;i++) {
            
            let shortCode = await ctx.db['p001'].collection('IDList').findOneAndDelete({}, {sort: {score: 1}})
            if (shortCode.ok == 1) { shortCode = shortCode.value._id }
            else { throw new ctx.err( {message: "SPECIAL", data: {msg: 'Error generating new Container printId' }} ) }
            
            containers.push({
                printId: shortCode,
                userDefinedName: shortCode,
                
                containerType_id: SKU._id,
                containerTypeShortCode: SKU.shortCode,
                containerTypeName: SKU.name,
                lengthM: SKU.lengthM,
                widthM: SKU.widthM,
                heightM: SKU.heightM,
                
                containerUserInfo_id: [],
                
                weightKG: 0,
                
                accountOwner_id: ctx.spFunction['p001'].getIdObj(acct_id),
                
                finishedEvents_id: [], //FIXME should already have an event here?  Container creation
                upcomingEvents_id: [],
                
                storageStartDate: null, //FIXME
                storageExpiryDate: null, //FIXME
                paidDuration: duration,
                paidTerms: rentMode,
                autoRenew: true,
                
                currentWHS_id: ctx.spFunction['p001'].getIdObj('5c3c47d33eb1334ee40f03d8'), //this is hardcoded to "temp zone"
                
                rentalOrder_id: ctx.spFunction['p001'].getIdObj(RO_id),
                status: 'EMPTY'
            })
        }
        
        console.log('addContainersFromDocLine, before insert, containers=', containers)
        //4. query & return
        const a = await ctx.db['p001'].collection('Container').insertMany(containers)
        console.log(a)
        
        let r
        if (a.result.ok==1) {
            r = a.ops.map(v=> _.pick(v, ['_id', 'printId', 'containerType_id', 'containerTypeShortCode', 'containerTypeName']))
        }
        
        return r
        
    } catch(e) { throw e }
}


//Implements http://schema.org/Place
export const typeDef = `
    
    enum containerStatus {
        EMPTY
        STORED
        PENDING_OUTBOUND
        IN_TRANSIT_TO_CUSTOMER
        WITH_CUSTOMER
        IN_TRANSIT_TO_WAREHOUSE
        PENDING_INBOUND
        DISBANDED
    }
    
    extend type Query {
        "need to be staff"
        getContainer(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [Container]
        
        "for customers, needs to be owner/manager/viewer of the account"
        getContainerById(_id: String, printId: String): Container
        
        "can be used by anyone, but should only be used by users as it will only return Containers own/manager/view by login user"
        getMyContainer: [Container]
    }
    
    extend type Mutation {
        "need login + be account owner/manager.  Normal user should call another method which is workflow related"
        addContainer(printId: String, containerType_id: String!, accountOwner_id: String!, containerType_id: String!, storageStartDate: GraphQLDate!, storageExpiryDate: GraphQLDate!, autoRenew: Boolean!, currentWHS_id: String!, rentalOrder_id: String!, status: containerStatus, weightKG: Float, userDefinedName: String): Container
        
        addEventToContainer(_id: String!, finishedEvents_id: [String], upcomingEvents_id: [String]): Container
    }
    
    type Container {
        _id: ID!,
        
        "A 4-char, human readable code for print and stick on containers.  Is unique, but not a system ID.  Auto assign by system, can also be assigned from request"
        printId: String!,
        
        userDefinedName: String,
        
        containerType_id: SKUMaster!,
        containerTypeShortCode: String!,
        containerTypeName: String!,
        "Length in m"
        lengthM: Float,
        "Length in m"
        widthM: Float,
        "Length in m"
        heightM: Float,
        
        containerUserInfo_id: [String],
        
        "Weight in kg"
        weightKG: Float,
        
        accountOwner_id: Account!,
        
        "Fixme create a event collection"
        finishedEvents_id: [String], 
        upcomingEvents_id: [String],
        
        storageStartDate: GraphQLDate,
        storageExpiryDate: GraphQLDate,
        
        "only use when box is just created but not sent to user."
        paidDuration: Int,
        "only use when box is just created but not sent to user."
        paidTerms: rentMode,
        
        autoRenew: Boolean,
        currentWHS_id: WHS,
        
        "The related Sales Order that leads to creation of this Container"
        rentalOrder_id: RentalOrder,
        
        "Status like Pending to ship to customer, In storage, In transit, etc"
        status: containerStatus
    }
    
    "Container List is a reduced set + snapshot of info for a Container, for embedding into other docs"
    type Container_subset {
        _id: ID!,
        printId: String!,
        containerType_id: SKUMaster!,
        containerTypeShortCode: String!,
        containerTypeName: String!
    }`
    
export const resolver = {
    Query: {
        getContainer: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isStaff(ctx)
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('Container'), args)
                //4. query & return
                const doc = await q.toArray()
                return doc
            } catch(e) { throw e }
        },
        getContainerById: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                //2. field checking
                ctx.spFunction['p001'].convertArgs(args)
                if (_.isEmpty(args)) {
                    throw new ctx.err({message: "MISSING_KEY_FIELDS", data: { }})
                }
                const doc = await ctx.db['p001'].collection('Container').findOne(args)
                if (doc==null) {
                    return {}
                }
                isAcctOwnerManagerViewer(ctx, doc.accountOwn_id)
                //3. add/mod fields
                //4. query & return
                return doc
            } catch(e) { throw e }
        },
        getMyContainer: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isActiveUser(ctx)
                //2. field checking
                const acctList = _.compact(_.union([], ctx.req.user.accountOwn_id, ctx.req.user.accountManage_id, ctx.req.user.accountView_id))
                if (acctList.length <1) { return {data:[]} }
                //3. add/mod fields
                //4. query & return
                const doc = await ctx.db['p001'].collection('Container').find({acccountOwner_id: {$in: acctList}}).toArray()
                return doc
            } catch(e) { throw e }
        }
    },
    Mutation: {
        addContainer: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isAdminOrSU(ctx)
                ctx.spFunction['p001'].convertArgs(args)
                //2. field checking
                const ownerCheck = await ctx.db['p001'].collection('Account').findOne({_id: args.accountOwner_id}, {projection: {isActive: 1}})
                if (!ownerCheck) {
                    throw new ctx.err({message: "NO_RECORD", data: {accountOwner_id: args.accountOwner_id }})
                }
                if (!ownerCheck.isActive) {
                    throw new ctx.err({message: "SUSPENDED", data: {accountOwner_id: args.accountOwner_id }})
                }
                
                const containerTypeCheck = await ctx.db['p001'].collection('SKUMaster').findOne({_id: args.containerType_id })
                
                if (!containerTypeCheck) {
                    throw new ctx.err({message: "NO_RECORD", data: {containerType_id: args.containerType_id }})
                }
                
                if (moment(args.storageExpiryDate).isBefore(args.storageStartDate)) {
                    throw new ctx.err({message: "INVALID", data: {storageStartDate: args.storageStartDate, storageExpiryDate: args.storageExpiryDate }})
                }
                
                const WHSCheck = await ctx.db['p001'].collection('WHS').find({_id: args.currentWHS_id}).count()
                if (WHSCheck<1) {
                    throw new ctx.err({message: "NO_RECORD", data: {currentWHS_id: args.currentWHS_id }})
                }
                
                const ROCheck = await ctx.db['p001'].collection('RentalOrder').findOne({_id: args.rentalOrder_id}, {projection: {status: 1}})
                if (!ROCheck) {
                    throw new ctx.err({message: "NO_RECORD", data: {rentalOrder_id: args.rentalOrder_id }})
                }
                if (!(ROCheck.status=='PROCESSING' | ROCheck.status=='PARTIAL_DELIVERED')) {
                    throw new ctx.err({message: "WRONG_STATUS", data: {rentalOrder_id: args.rentalOrder_id }})
                }
                
                //3. add/mod fields
                if (!args['printId']) { args['printId'] = await getUsableShortId(ctx) }
                if (!args['status']) { args['status'] = 'EMPTY' }
                if (!args['weightKG']) { args['weightKG'] = 0 }
                if (!args['userDefinedName']) { args['userDefinedName'] = '' }
                args['containerTypeShortCode'] = containerTypeCheck.shortCode
                args['containerTypeName'] = containerTypeCheck.name
                args['lengthM'] = containerTypeCheck.length
                args['widthM'] = containerTypeCheck.width
                args['heightM'] = containerTypeCheck.height
                args['finishedEvents_id'] = []
                args['upcomingEvents_id'] = []
                args['containerUserInfo_id'] = []

                
                //4. query & return
                const a = await ctx.db['p001'].collection('Container').insertOne(args);
                //Fixme also insert owner into User doc
                return a.ops[0]
                
            } catch(e) { throw e }
        },
        /*updateContainer: async (obj, args, ctx, info) => {

            try {
                //1. check for access requirement
                ctx.spFunction['p001'].convertArgs(args)
                const id = args._id
                const op = args.op
                args = _.omit(_.omit(args, '_id'), 'op')
                
                if (_.isEmpty(args)) { //make sure there are something to update
                    throw new ctx.err({message: "NO_FIELDS_TO_UPDATE", data: {} })
                }
                
                const c = await ctx.db['p001'].collection('Container').findOne( {_id: id})
                console.log("c=", c)
                if (c==null) { //confirm container exists
                    throw new ctx.err({message: "NO_RECORD", data: {_id: id }})
                }
                const allUserIds = getAccountOwnerManager(ctx.db['p001'], c.accountOwner_id) //Make sure current user own/manage this container
                isTargetUserOrStaff(ctx, allUserIds)
                //2. field checking
                
                if (args.hasOwnProperty('printId')) {
                    const printIdCount = await ctx.db['p001'].collection('Container').find( {printId: args['printId'], status: {$ne: 'DISBANDED'}}
                    ).count()
                    if (printIdCount > 0) {
                        throw new ctx.err({message: "KEY_EXIST", data: {printId: args['printId']} })
                    }
                }
                
                if (args.hasOwnProperty('containerType_id')) {
                     const containerTypeCheck = await ctx.db['p001'].collection('SKUMaster').findOne( {_id: args['containerType_id'], isActive: true})
                    if (containerTypeCheck==null) {
                        throw new ctx.err({message: "INVALID", data: {containerType_id: args['containerType_id']} })
                    }
                    args['containerTypeName'] = containerTypeCheck.name
                    args['lengthM'] = containerTypeCheck.length
                    args['widthM'] = containerTypeCheck.width
                    args['heightM'] = containerTypeCheck.height
                }
                
                if (args.hasOwnProperty('accountOwner_id')) {
                    const ownerCheck = await ctx.db['p001'].collection('Account').findOne({_id: args.accountOwner_id}, {projection: {isActive: 1}})
                    if (!ownerCheck) {
                        throw new ctx.err({message: "NO_RECORD", data: {accountOwner_id: args.accountOwner_id }})
                    }
                    if (!ownerCheck.isActive) {
                        throw new ctx.err({message: "SUSPENDED", data: {accountOwner_id: args.accountOwner_id }})
                    }
                }
                
                if (args.hasOwnProperty('storageStartDate') | args.hasOwnProperty('storageExpiryDate')) {

                    if (!args.hasOwnProperty('storageStartDate')) { args['storageStartDate'] = c.storageStartDate }
                    if (!args.hasOwnProperty('storageExpiryDate')) { args['storageExpiryDate'] = c.storageExpiryDate }
                    if (moment(args.storageExpiryDate).isBefore(args.storageStartDate)) {
                        throw new ctx.err({message: "INVALID", data: {storageStartDate: args.storageStartDate, storageExpiryDate: args.storageExpiryDate }})
                    }
                }
                
                if (args.hasOwnProperty('currentWHS_id')) {
                    const WHSCheck = await ctx.db['p001'].collection('WHS').find({_id: args.currentWHS_id}).count()
                    if (WHSCheck<1) {
                        throw new ctx.err({message: "NO_RECORD", data: {currentWHS_id: args.currentWHS_id }})
                    }
                }
                
                if (args.hasOwnProperty('salesOrder_id')) {
                    const SOCheck = await ctx.db['p001'].collection('SalesOrder').findOne({_id: args.salesOrder_id}, {projection: {status: 1}})
                    if (!SOCheck) {
                        throw new ctx.err({message: "NO_RECORD", data: {salesOrder_id: args.salesOrder_id }})
                    }
                    if (!(SOCheck.status=='PROCESSING' | SOCheck.status=='PARTIAL_DELIVERED')) {
                        throw new ctx.err({message: "WRONG_STATUS", data: {salesOrder_id: args.salesOrder_id }})
                    }
                }
                
                //3. add/mod fields
                args['updateDateTime'] = moment().toDate()
                //4. query & return
                //Fixme also insert manager/viewer into User doc
                const doc = await ctx.db['p001'].collection('Container').findOneAndUpdate({_id: id }, getUpdateField(op, args), {returnOriginal: false})
                return doc.value
            } catch(e) { throw e }
        },*/
        addEventToContainer: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                ctx.spFunction['p001'].convertArgs(args)
                
                const c = await ctx.db['p001'].collection('Container').findOne( {_id: args._id})
                console.log('c=', c.accountOwner_id)
                if (c==null) { //confirm container exists
                    throw new ctx.err({message: "NO_RECORD", data: {_id: args._id }})
                }
                const allUserIds = await getAccountOwnerManager(ctx.db['p001'], c.accountOwner_id) //Make sure current user own/manage this container
                isTargetUserOrStaff(ctx, allUserIds)
            //2. field checking
            //3. add/mod fields
                let update_fields = {}
                let haveFieldsToUpdate = false
                if (args.hasOwnProperty('finishedEvents_id')) {
                    if (args.finishedEvents_id.length > 0) {
                        haveFieldsToUpdate = true
                        update_fields = { finishedEvents_id: {$each: args.finishedEvents_id}}
                    }
                }
                if (args.hasOwnProperty('upcomingEvents_id')) {
                    if (args.upcomingEvents_id.length > 0) {
                        haveFieldsToUpdate = true
                        update_fields = _.merge(update_fields, { upcomingEvents_id: {$each: args.upcomingEvents_id}})
                    }
                }
                if (!haveFieldsToUpdate) {
                    throw new ctx.err({message: "NO_FIELDS_TO_UPDATE", data: {finishedEvents_id: [], upcomingEvents_id: []} })
                }
            //4. query & return
                const doc = await ctx.db['p001'].collection('Container').findOneAndUpdate({_id: args._id}, {$push: update_fields}, {returnOriginal: false})
                return doc.value
            } catch(e) { throw e }
        }
    },
    Account: {
        containerList: async (obj, args, ctx, info) => {
            try {
                console.log('Account.containerList, obj=', obj)
                const doc = await ctx.db['p001'].collection('Container').find({accountOwner_id: obj._id}).toArray()
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

const getUsableShortId = async (ctx) => {
    let id = genShortId()
    let a = await ctx.db['p001'].collection('Container').find({printId: id, status:{$ne: 'DISBANDED'}}, {projection: {printId: 1}}).count()
    if (a>0) { return getUsableShortId(ctx) } 
    else { return id }
}