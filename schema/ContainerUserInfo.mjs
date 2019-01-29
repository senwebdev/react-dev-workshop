import _ from 'lodash'
import { isAdminOrSU } from '../auth/auth.mjs'

export const typeDef = `

    extend type Query {
        getContainerUserInfo(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [ContainerUserInfo]
    }
    
    extend type Mutation {
        "need admin"
        addContainerUserInfo(container_id: String!, text: String, pic: String, tag: [String]): ContainerUserInfo
        
        "need admin"
        updateContainerUserInfo(_id: String!, op: updateOp!, container_id: String!, text: String, pic: String, tag: [String]): ContainerUserInfo
        
    }
    
    type ContainerUserInfo {
        _id: ID!,
        container_id: Container!,
        accountOwner_id: Account,
        text: String,
        pic: String,
        tag: [String]
    }`
    
export const resolver = {
    Query: {
        getContainerUserInfo: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('ContainerUserInfo'), args)
                //4. query & return
                const doc =  await q.toArray()
                return doc
            } catch(e) { throw e }
        },
    },
    Mutation: {
        addContainerUserInfo: async (obj, args, ctx, info) => {
            //#4 Fixme add checking mechanism here
            try {
                //1. check for access requirement
                isAdminOrSU(ctx)
                //2. field checking
                //3. add/mod fields
                //4. query & return
                const a = await ctx.db['p001'].collection('ContainerUserInfo').insertOne(args);
                return a.ops[0]
            } catch(e) { throw e }
        },
        updateContainerUserInfo: async (obj, args, ctx, info) => {
            //#5 Fixme add checking mechanism here
            try {
                //1. check for access requirement
                isAdminOrSU(ctx)
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                const id = args._id
                const op = args.op
                let update_fields = _.omit(_.omit(args, '_id'), 'op')
                //4. query & return
                const doc = await ctx.db['p001'].collection('ContainerUserInfo').findOneAndUpdate({_id: id }, getUpdateField(op, update_fields), {returnOriginal: false})
                return doc.value
            } catch(e) { throw e }
        }
    },
    Container: {
        containerUserInfo_id: async (obj, args, ctx, info) => {
            try {
                const doc = await ctx.db['p001'].collection('ContainerUserInfo').find({_id: {$in:obj.containerUserInfo_id}}).toArray()
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