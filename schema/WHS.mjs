import _ from 'lodash'
import { isAdmin, isActiveUser } from '../auth/auth.mjs'

//Implements http://schema.org/Place
export const typeDef = `
    
    extend type Query {
        "need login"
        getWHS(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [WHS]
        
    }
    
    extend type Mutation {
        "need login + be admin"
        addWHS(description: String!, name: String!, address_id: String!, branchCode: String!, zoneCode: String!): WHS
        
        "need login + be admin"
        updateWHS(_id: String!, op: updateOp!, description: String, name: String, address_id: String, branchCode: String, zoneCode: String, isActive: Boolean): WHS
    }
    
    type WHS {
        _id: ID!,
        description: String,
        name: String,
        address_id: Address,
        
        "branchCode identifies a warehouse site"
        branchCode: String!,
        
        "zoneCode identifies a zone inside a branch"
        zoneCode: String!,
        isActive: Boolean!
    }`
    
export const resolver = {
    Query: {
        getWHS: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isActiveUser(ctx)
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('WHS'), args)
                //4. query & return
                const a =  await q.toArray()
                return a
            } catch(e) { throw e }
        }
    },
    Mutation: {
        addWHS: async (obj, args, ctx, info) => {
            //#4 Fixme add checking mechanism here
            try {
                //1. check for access requirement
                isAdmin(ctx)
                //2. field checking
                //3. add/mod fields
                args['isActive'] = true
                //4. query & return
                const a = await ctx.db['p001'].collection('WHS').insertOne(args);
                return a.ops[0]
            } catch(e) { throw e }
        },
        updateWHS: async (obj, args, ctx, info) => {
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
                const doc = await ctx.db['p001'].collection('WHS').findOneAndUpdate({_id: id }, getUpdateField(op, update_fields), {returnOriginal: false})
                return doc
            } catch(e) { throw e }
        }
    },
    Container: {
        currentWHS_id: async (obj, args, ctx, info) => {
            try {
                const doc = await ctx.db['p001'].collection('WHS').findOne({_id: obj.currentWHS_id})
                return doc
            } catch(e) { throw e }
        },
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