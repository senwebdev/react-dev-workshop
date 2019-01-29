import _ from 'lodash'
import moment from 'moment'
import { isStaff, isTargetUser, isAdminOrSU, isActiveUser, isTargetUserOrStaff }  from '../auth/auth.mjs'

export const docType = ['Quotation', 'RentalOrder', 'PickupOrder', 'DeliveryOrder', 'Invoice', 'PackingList', 'DeliveryNote', 'PickUpNote', 'CreditNote', 'TransferNote', 'PurchaseOrder', 'GoodsReception', 'DebitNote']

export const addDocEvent = async (obj, args, ctx, info) => {
    //args = {docType, docEventType, doc_id, msg}
    
    try {
        //1. check for access requirement
        ctx.spFunction['p001'].convertArgs(args)
        //2. field checking
        //3. add/mod fields
        args['user_id'] = (ctx.req.user) ? ctx.req.user._id : undefined
        args['userName'] = (ctx.req.user) ? (ctx.req.user.firstName + ' ' + ctx.req.user.lastName) : 'NOT LOGGED IN'
        args['createDateTime'] = moment().toDate()

        //4. query & return
        const a = await ctx.db['p001'].collection('DocEvent').insertOne(args)
        
        const b = await ctx.db['p001'].collection(args.docType).updateOne({_id: args.doc_id}, {$push: {docEvent_id: a.ops[0]._id}, $set:{updateDateTime: args.createDateTime}})
        
        return a.ops[0]
    } catch(e) { throw e }
}



export const typeDef = `
    enum docType {
        Quotation
        RentalOrder
        PickupOrder
        DeliveryOrder
        Invoice
        PackingList
        DeliveryNote
        PickUpNote
        CreditNote
        TransferNote
        PurchaseOrder
        GoodsReception
        DebitNote
    }
    
    enum docEventType {
        CREATE
        LOAD
        UPDATE
        PRINT
        HOLD
        UNHOLD
        CANCEL
        OTHERS
    }
    
    extend type Query {
        getDocEvent(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [DocEvent]
    }
    
    extend type Mutation {
        addDocEvent(docType: docType!, docEventType: docEventType!, doc_id: String!, msg: String!): DocEvent
        
        updateDocEvent(_id: String, docType: docType, docEventType: docEventType, doc_id: String, msg: String): DocEvent
    }
    
    type DocEvent {
        _id: ID!,
        docType: docType,
        docEventType: docEventType,
        doc_id: String,
        msg: String,
        user_id: User,
        userName: String,
        createDateTime: GraphQLDateTime
    }`
    
export const resolver = {
    Query: {
        getDocEvent: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isStaff(ctx)
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('DocEvent'), args)
                //4. query & return
                const doc = await q.toArray()
                return doc
            } catch(e) { throw e }
        }
    },
    Mutation: {
        addDocEvent: async (obj, args, ctx, info) => {
            //limited to admin or SU since normal user should not add events manually.  to remove from user API.
            try {
                isAdminOrSU(ctx)
                const a = await addDocEvent(obj, args, ctx, info)
                return a
            } catch(e) { throw e }
        },
        updateDocEvent: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isAdminOrSU(ctx)
                ctx.spFunction['p001'].convertArgs(args)
                //2. field checking
                const id = args._id
                args = _.omit(args, '_id')
                if (_.isEmpty(args)) { //make sure there are something to update
                    throw new ctx.err({message: "NO_FIELDS_TO_UPDATE", data: {} })
                }
                //3. add/mod fields
                //4. query & return
                const doc = await ctx.db['p001'].collection('ContainerEvent').findOneAndUpdate({_id: id }, {$SET: args}, {returnOriginal: false})
                return doc.value
            } catch(e) { throw e }
        }
    },
    RentalOrder: {
        docEvent_id: async (obj, args, ctx, info) => {
            try {
                const docs = await ctx.db['p001'].collection('DocEvent').find({_id: {$in: obj.docEvent_id}}).toArray()
                return docs
            } catch(e) { throw e }
        }
    },
    Invoice: {
        docEvent_id: async (obj, args, ctx, info) => {
            try {
                const docs = await ctx.db['p001'].collection('DocEvent').find({_id: {$in: obj.docEvent_id}}).toArray()
                return docs
            } catch(e) { throw e }
        }
    },
    Quotation: {
        docEvent_id: async (obj, args, ctx, info) => {
            try {
                const docs = await ctx.db['p001'].collection('DocEvent').find({_id: {$in: obj.docEvent_id}}).toArray()
                return docs
            } catch(e) { throw e }
        }
    }
}