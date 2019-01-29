import _ from 'lodash'
import { isAdmin } from '../auth/auth.mjs'

export const typeDef = `
    
    enum deliveryStatus {
        PENDING
        ASSIGNED
        IN_TRANSIT
        ARRIVING
        COMPLETED
        HOLD
        CANCELLED
        AWAIT_RECIPIENT
    }
    
    extend type Query {
        getDeliveryNote(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [DeliveryNote]
    }
    
    extend type Mutation {
        "need admin"
        addDeliveryNote(shortCode: String!, name: String!, longDesc: String!, iconPicURL: String!, smallPicURL: String!, largePicURL: String!, otherPicURL:[String]!, standardPriceDay: Float!, standardPriceMonth: Float!, length: Float!, width: Float!, height: Float!): DeliveryNote
        
        "need admin"
        updateDeliveryNote(_id: String!, op: updateOp!, shortCode: String, name: String, longDesc: String, iconPicURL: String, smallPicURL: String, largePicURL: String, otherPicURL:[String], standardPriceDay: Float, standardPriceMonth: Float, length: Float, width: Float, height: Float, isActive: Boolean): DeliveryNote
    }
    
    type DeliveryNote {
        _id: ID!,
        version: String,
        status: deliveryStatus,
        packingList_id: String,
        salesOrder_id: String,
        deliveryDetails: [DeliveryNoteDetails],
        courier: User,
        
        "Should be Vehicle ID instead of String, Fixme"
        courierVehicle: String,
        createDateTime: GraphQLDateTime,
        createUser_id: User,
        updateDateTime: GraphQLDateTime,
        updateUser_id: User,
        isActive: Boolean!
    }
    
    type DeliveryNoteDetails {
        container_id: String,
        containerPrintId: String
    }`
    
export const resolver = {
    Query: {
        getDeliveryNote: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('DeliveryNote'), args)
                //4. query & return
                const doc =  await q.toArray()
                return doc
            } catch(e) { throw e }
        },
    },
    Mutation: {
        addDeliveryNote: async (obj, args, ctx, info) => {
            //#4 Fixme add checking mechanism here
            try {
                //1. check for access requirement
                isAdmin(ctx)
                //2. field checking
                //3. add/mod fields
                args['isActive'] = true
                //4. query & return
                const a = await ctx.db['p001'].collection('DeliveryNote').insertOne(args);
                return a.ops[0]
            } catch(e) { throw e }
        },
        updateDeliveryNote: async (obj, args, ctx, info) => {
            //#5 Fixme add checking mechanism here
            try {
                //1. check for access requirement
                isAdmin(ctx)
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                const id = args._id
                const op= args.op
                let update_fields = _.omit(_.omit(args, '_id'), 'op')
                //4. query & return
                const doc = await ctx.db['p001'].collection('DeliveryNote').findOneAndUpdate({_id: id }, getUpdateField(op, update_fields), {returnOriginal: false})
                return doc.value
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