import mongo from 'mongodb'
import _ from 'lodash'

export async function dbConnect() {
    //mongodb.db('p001').serverConfig.isConnected() 
    try {
        const mongodb = await mongo.MongoClient.connect(process.env.MONGO_URI, { useNewUrlParser: true } )
        console.log('mongo connected')
        return Promise.resolve(mongodb.db('p001'))
    }
    catch(e) { console.log(e) }
}

export const convertArgs = (a) => { //this cannot handle array of objects.
    if (a && _.isPlainObject(a)) {
        console.log('isobject')
        Object.entries(a).forEach(([k,v]) => {
            if (v && _.isPlainObject(v)) { convertArgs(v) }
            
            else if (v && Array.isArray(v)) {
                for(let i=0;i<v.length;i++) {
                    
                    a[k][i] = processFilter(k,v[i])
                }
            }
            else { a[k] = processFilter(k,v) }
        })
    }
    else {
        throw new Error('convertArgs has a non-object args a=', a)
    }
}

export const evalParam = (table, input_args) => {
    let return_query = table
    
    //if there's no 'where', put a empty find so as to change return_query to a cursor
    if (_.has(input_args, 'where')) {
        return_query = return_query.find(getFilterObject(input_args['where']))
        input_args = _.omit(input_args, 'where')
    } else {
        return_query = return_query.find()
    }
    
    if (_.has(input_args, 'orderBy') & _.has(input_args, 'orderDirection')) {
        let sort
        sort[input_args['orderBy']] = (input_args['orderDirection'] == 'ASC' ? 1 : -1)
        
        return_query = return_query.sort(sort)
        input_args = _.omit(input_args, 'orderBy')
        input_args = _.omit(input_args, 'orderDirection')
    }
    if (_.has(input_args, 'offset')) {
        return_query = return_query.skip(input_args['skip'])
        input_args = _.omit(input_args, 'offset')
    }
    if (_.has(input_args, 'limit')) {
        return_query = return_query.limit(input_args['limit'])
        input_args = _.omit(input_args, 'limit')
    }

    return [return_query, input_args]
}

const getFilterObject = (obj) => {
    let filter = {}
    if (_.has(obj, 'AND')) {
        if (obj.length > 2) throw new Error('AND filter have more than 1 sibling, ', obj)
        if (obj['AND'].length < 2) throw new Error('AND filter have less than 2 children, ', obj)
        let t = []
        for (let y of obj['AND']) { t.push(getFilterObject(y)) }
        filter = _.merge(filter, {'$and': t})
        return filter
    }
    if (_.has(obj, 'OR')) {
        if (obj.length > 2) throw new Error('OR filter have more than 1 sibling, ', obj)
        if (obj['OR'].length < 2) throw new Error('OR filter have less than 2 children, ', obj)
        let t = []
        for (let y of obj['OR']) { t.push(getFilterObject(y)) }
        filter = _.merge(filter, {'$or': t})
        return filter
    }
    switch(obj.op) {
        case 'EQ': filter[obj.field] = processFilter(obj.field, obj.filter) ; break;
        case 'NE': filter[obj.field] = { $ne: processFilter(obj.field, obj.filter) }; break;
        case 'LTE': filter[obj.field] = { $lte: obj.filter }; break;
        case 'GTE': filter[obj.field] = { $gte: obj.filter }; break;
        case 'LIKE': filter[obj.field] = new RegExp(obj.filter, "g"); break;
        case 'NLIKE': filter[obj.field] = { $not: new RegExp(obj.filter, "g") }; break;
    }
    return filter
}

const processFilter = (name, v) => {
    //in schema, all ids must end with _id to process properly
    if (name.substr(-3)== '_id') { return getIdObj(v) }
    else { return v }
}

export const getIdObj = (id) => { return mongo.ObjectID(id) }