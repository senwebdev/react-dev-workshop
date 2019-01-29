import _ from 'lodash'
import { isAdmin } from '../auth/auth.mjs'

export const typeDef = `
    
    enum pickUpStatus {
        PENDING
        ASSIGNED
        IN_TRANSIT
        COMPLETED
        HOLD
        CANCELLED
        AWAIT_SENDER
    }
    
    extend type Query {
        getPickUpNote(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [DeliveryNote]
    }
    
    extend type Mutation {
        "need admin"
        addPickUpNote(shortCode: String!, name: String!, longDesc: String!, iconPicURL: String!, smallPicURL: String!, largePicURL: String!, otherPicURL:[String]!, standardPriceDay: Float!, standardPriceMonth: Float!, length: Float!, width: Float!, height: Float!): DeliveryNote
        
        "need admin"
        updatePickUpNote(_id: String!, op: updateOp!, shortCode: String, name: String, longDesc: String, iconPicURL: String, smallPicURL: String, largePicURL: String, otherPicURL:[String], standardPriceDay: Float, standardPriceMonth: Float, length: Float, width: Float, height: Float, isActive: Boolean): DeliveryNote
    }
    
    type PickUpNote {
        _id: ID!,
        version: String,
        status: pickUpStatus,
        salesOrder_id: String,
        pickUpDetails: [PickUpNoteDetails],
        courier: User,
        courierVehicle: Vehicle,
        createDateTime: GraphQLDateTime,
        createUser_id: User,
        updateDateTime: GraphQLDateTime,
        updateUser_id: User,
        isActive: Boolean!
    }
    
    type PickUpNoteDetails {
        container_id: String,
        containerPrintId: String,
        weightKG: Float,
        remarks: String
    }`
    
export const resolver = {
    Query: {
        getPickUpNote: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('PickUpNote'), args)
                //4. query & return
                const doc =  await q.toArray()
                return doc
            } catch(e) { throw e }
        },
    },
    Mutation: {
        addPickUpNote: async (obj, args, ctx, info) => {
            //#4 Fixme add checking mechanism here
            try {
                //1. check for access requirement
                isAdmin(ctx)
                //2. field checking
                //3. add/mod fields
                args['isActive'] = true
                //4. query & return
                const a = await ctx.db['p001'].collection('PickUpNote').insertOne(args);
                return a.ops[0]
            } catch(e) { throw e }
        },
        updatePickUpNote: async (obj, args, ctx, info) => {
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
                const doc = await ctx.db['p001'].collection('PickUpNote').findOneAndUpdate({_id: id }, getUpdateField(op, update_fields), {returnOriginal: false})
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