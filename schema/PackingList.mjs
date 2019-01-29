import _ from 'lodash'
import { isAdmin } from '../auth/auth.mjs'

export const typeDef = `
    
    enum packingStatus {
        PENDING
        ASSIGNED
        COMPLETED
        HOLD
        CANCELLED
    }
    
    extend type Query {
        getPackingList(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [PackingList]
    }
    
    extend type Mutation {
        "need admin"
        addPackingList(shortCode: String!, name: String!, longDesc: String!, iconPicURL: String!, smallPicURL: String!, largePicURL: String!, otherPicURL:[String]!, standardPriceDay: Float!, standardPriceMonth: Float!, length: Float!, width: Float!, height: Float!): PackingList
        
        "need admin"
        updatePackingList(_id: String!, op: updateOp!, shortCode: String, name: String, longDesc: String, iconPicURL: String, smallPicURL: String, largePicURL: String, otherPicURL:[String], standardPriceDay: Float, standardPriceMonth: Float, length: Float, width: Float, height: Float, isActive: Boolean): PackingList
    }
    
    type PackingList {
        _id: ID!,
        version: String,
        status: packingStatus,
        
        salesOrder_id: String,
        
        docLines: [String],
        packer_id: User,
        
        createDateTime: GraphQLDateTime,
        createUser_id: User,
        updateDateTime: GraphQLDateTime,
        updateUser_id: User
    }`
    
export const resolver = {
    Query: {
        getPackingList: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('PackingList'), args)
                //4. query & return
                const doc =  await q.toArray()
                return doc
            } catch(e) { throw e }
        },
    },
    Mutation: {
        addPackingList: async (obj, args, ctx, info) => {
            //#4 Fixme add checking mechanism here
            try {
                //1. check for access requirement
                isAdmin(ctx)
                //2. field checking
                //3. add/mod fields
                args['isActive'] = true
                //4. query & return
                const a = await ctx.db['p001'].collection('PackingList').insertOne(args);
                return a.ops[0]
            } catch(e) { throw e }
        },
        updatePackingList: async (obj, args, ctx, info) => {
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
                const doc = await ctx.db['p001'].collection('PackingList').findOneAndUpdate({_id: id }, getUpdateField(op, update_fields), {returnOriginal: false})
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