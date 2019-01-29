import _ from 'lodash'
import moment from 'moment'
import { isStaff, isSU }  from '../auth/auth.mjs'

export const containerEventType = ['SHIPTO_WAREHOUSE', 'SHIPTO_CUSTOMER', 'SEND_EMPTY_CONTAINER', 'RETURN_EMPTY_CONTAINER']
export const containerDocType = ['PackingList', 'DeliveryNote', 'PickUpNote', 'TransferNote']

export const typeDef = `
    
    enum containerDocType {
        PackingList
        DeliveryNote
        PickUpNote
        TransferNote
        OTHERS
    }
    
    enum containerEventType {
        SHIP_TO_WAREHOUSE
        SHIP_TO_CUSTOMER
        SHIP_TO_OTHERS
        CREATE
        DISBAND
    }
    
    extend type Query {
        getContainerEvent(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [ContainerEvent]
    }
    
    extend type Mutation {
        "not intended to be used.  adding container should always be in workflow."
        addContainerEvent(container_id: String!, isVisibleToCustomer: Boolean!, isVisibleToStaff: Boolean!, docType: containerDocType!, doc_id: String!, msgAdmin: String!, msgCustomer: String, eventType: containerEventType!): ContainerEvent
        
        "Need to be SU, not intended to be used under normal circumstances"
        updateContainerEvent(_id: String!, op: updateOp!, container_id: String, isVisibleToCustomer: Boolean, isVisibleToStaff: Boolean, docType: containerDocType, doc_id: String, msgAdmin: String, msgCUstomer: String, eventType: containerEventType): ContainerEvent
    }
    
    type ContainerEvent {
        _id: ID!,
        container_id: Container,
        
        isVisibleToCustomer: Boolean,
        isVisibleToStaff: Boolean,
        
        "Document related to this event.  Event should always be triggered by user action, and user action always result into a document, which has their own workflow."
        docType: containerDocType,
        doc_id: String,
        msgAdmin: String,
        msgCustomer: String,
        eventType: containerEventType,
        createDateTime: GraphQLDateTime,
        createUser_id: User,
    }`
    
export const resolver = {
    Query: {
        getContainerEvent: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isStaff(ctx)
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('ContainerEvent'), args)
                //4. query & return
                const doc = await q.toArray()
                return doc
            } catch(e) { throw e }
        }
    },
    Mutation: {
        addContainerEvent: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isSU(ctx)
                ctx.spFunction['p001'].convertArgs(args)
                //2. field checking
                //3. add/mod fields
                args['createDateTime'] = moment().toDate()
                args['createUser_id'] = ctx.req.user._id

                //4. query & return
                const a = await ctx.db['p001'].collection('ContainerEvent').insertOne(args);
                //Fixme also insert owner into User doc
                return a.ops[0]
                
            } catch(e) { throw e }
        },
        updateContainerEvent: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isSU(ctx)
                ctx.spFunction['p001'].convertArgs(args)
                //2. field checking
                const id = args._id
                const op = args.op
                args = _.omit(_.omit(args, '_id'), 'op')
                if (_.isEmpty(args)) { //make sure there are something to update
                    throw new ctx.err({message: "NO_FIELDS_TO_UPDATE", data: {} })
                }
                //3. add/mod fields
                //4. query & return
                const doc = await ctx.db['p001'].collection('ContainerEvent').findOneAndUpdate({_id: id }, getUpdateField(op, args), {returnOriginal: false})
                return doc.value
                
            } catch(e) { throw e }
        }
    },
    Container: {
        finishedEvents_id: async (obj, args, ctx, info) => {
            try {
                const doc = await ctx.db['p001'].collection('ContainerEvent').find({_id: {$in: obj.finishedEvents_id}}).toArray()
                return doc
            } catch(e) { throw e }
        },
        upcomingEvents_id: async (obj, args, ctx, info) => {
            try {
                const doc = await ctx.db['p001'].collection('ContainerEvent').find({_id: {$in: obj.upcomingEvents_id}}).toArray()
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