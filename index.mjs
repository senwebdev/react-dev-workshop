import dotenv from 'dotenv/config'
import https from 'https'
import fs from 'fs'
import cors from 'cors'
import helmet from 'helmet'
import express from 'express'
import logger from 'morgan'
import bodyParser from 'body-parser'
import expressSession from 'express-session'
import cm from 'connect-mongo'
import apolloServerExpress from 'apollo-server-express'
import ae from 'apollo-errors'
import passport from 'passport'
import passportLocal from 'passport-local'
import sendMail from './util/sendMail.mjs'
import Sentry from '@sentry/node'

import { authUserLocal, getUserById }  from './auth/auth.mjs'

import { schema } from './schema/schema.mjs'
import { schemaPublic } from './schema/schemaPublic.mjs'

import { dbConnect as p001Connect, evalParam as p001Eval, convertArgs as p001ConvertArgs, getIdObj } from './db/p001.mjs'

const PORT = 3000
const app = express()
app.disable('x-powered-by');


const isLogined = (req, res, next) => {
    if (req.isAuthenticated()) { 
        console.log('login success')
        return next()
    }
    else {
        console.log('login failed')
        res.status(401)
        res.send('KO')
    }
}
/*
const options = {
    cert: fs.readFileSync('./cert.pem'),
    key: fs.readFileSync('./privkey.pem'),
    ca: fs.readFileSync('./chain.pem')
};

const isSecure = (req)=> {
    if (req.secure) {  return true }
    if (req.headers['x-arr-log-id'] ) { return typeof req.headers['x-arr-ssl'] === 'string' }
    return req.headers['x-forwarded-proto'] === 'https';
}

const httpsRedirect = (req, res, next) => {
    if (req.secure) { return next() }
    res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url })
    res.end()
}
*/

const init = async () => {
    try {
        /*
        Sentry.init({ dsn: process.env. })
        
        Sentry.configureScope(scope => {
            scope.setTag('source', 'p001-backend')
        })*/

        const router = express.Router()
        const CORSWhiteList = ['http://wisekeep.hk:8080', 'http://www.wisekeep.hk:8080', "http://localhost:3000"]
        
        app.use(logger('combined'))
        //app.use(httpsRedirect)
        //app.use(helmet())
        
        const MongoSessionStore = cm(expressSession)
        const db =  {
            p001: await p001Connect()
        }
        const evalParam = {
            p001: p001Eval
        }
        const spFunction = {
            p001: {
                convertArgs: p001ConvertArgs,
                getIdObj: getIdObj
            },
            sendMail: sendMail
        }
        
        /*const testFunc = async (req, res, next) => {
            let a = await db.p001.collection('User').findOneAndUpdate({_id:"aaa"}, {firstName:"aaa"})
            console.log(a)
            return next()
        }*/
        
        app.use(expressSession({
            secret: 'p001',
            saveUninitialized: false,
            resave: false,
            cookie: { httpOnly: true, secure: true },
            store: new MongoSessionStore({
                db: db.p001,
                ttl: 24 * 60 * 60 * 180, //1-day
                autoRemove: 'native',
                collection: 'app_session'
            })
        }))
        app.use(bodyParser.json())
        app.use(passport.initialize())
        app.use(passport.session())
        
        app.set('trust proxy', true)
        /*app.use(cors({
            credentials: true,
            origin: (origin, cb) => {
                if(!origin) return cb(null, true)
                if (CORSWhiteList.indexOf(origin) !== -1) { cb(null, true) }
                else { 
                    console.log('origin', origin)
                    cb(new Error('Not allowed by CORS'))
                }
            }
        }))*/
        
        
        passport.serializeUser(async (u, cb) => {
            console.log('passport.serializeUser')
            cb(null, u)
        })
        
        passport.deserializeUser(async (id, cb) => {
            const doc = await db.p001.collection('User').findOne({_id: getIdObj(id) })
            cb(null, doc)
        })
        
        passport.use(new passportLocal.Strategy(
            {
                usernameField: 'user',
                passwordField: 'password',
                session: true,
                passReqToCallback: true
            }, async (req, username, password, cb) => {
                try {
                    const a = await authUserLocal(db.p001, username, password)
                    return cb(null, a)
                } catch(e) {
                    return cb(null, false)
                }
            }
        ))
        
        router.get('/api', (req, res) => res.type('html').send('aaa'))
        
        router.post(
            '/api/l',
            /*cors({
                credentials: true,
                origin: CORSWhiteList
            }),*/
            passport.authenticate('local'),
            (req, res) => {
                res.status(200)
                res.json({status: 'ok'})
                console.log('/l login success')
            }
        )
        
        router.get(
            '/api/checkl',
            /*cors({
                credentials: true,
                origin: CORSWhiteList
            }),*/
            (req, res) => {
                console.log('checkl')
                if (req.isAuthenticated()) {
                    res.status(200)
                    res.send('OK')
                }
                else {
                    res.status(401)
                    res.send('KO')
                }
            }
        )
        
        router.get('/api/logout',
            /*cors({
                credentials: true,
                origin: (origin, cb) => {
                    if(!origin) return cb(null, true)
                    if (CORSWhiteList.indexOf(origin) !== -1) { cb(null, true) }
                    else { 
                        console.log('origin', origin)
                        cb(new Error('Not allowed by CORS'))
                    }
                }
            }),*/
            function(req, res){
            req.logout()
            res.json({status: 'ok'})
        })
        
        router.use(
            '/api/gql',
            /*cors({
                credentials: true,
                origin: 'http://localhost:3000'//CORSWhiteList
            }),*/
            isLogined,
            //bodyParser.json(),
            /*(req, res, next)=> {
                console.log(req.body)
                return next()
            },*/
            apolloServerExpress.graphqlExpress((req)=> {
                console.log('arrived apollo')
                return {
                    formatError: ae.formatError,
                    schema: schema,
                    context: {
                        req: req,
                        db: db,
                        evalParam: evalParam,
                        spFunction: spFunction,
                        err: ae.createError('p001Error', {message: 'aaa'}),
                        debug: true
                    }
                }
            })
        )
        
        router.use(
            '/api/gqlPublic', 
            /*cors(),*/
            //bodyParser.json(),
            /*(req, res, next) => {
                console.log('query=',req.body.query)
                console.log('user=', req.user)
                return next()
            },*/
            apolloServerExpress.graphqlExpress((req)=> {
                console.log('arrived gqlPublic')
                return {
                    formatError: ae.formatError,
                    schema: schemaPublic,
                    context: {
                        req: req,
                        db: db,
                        evalParam: evalParam,
                        spFunction: spFunction,
                        err: ae.createError('p001Error', {message: 'aaa'}),
                        debug: true
                    }
                }
            })
        )
        
        router.use('/api/graphiql', isLogined, apolloServerExpress.graphiqlExpress({ endpointURL: '/api/gql' }))
        router.use('/api/graphiqlPublic', apolloServerExpress.graphiqlExpress({ endpointURL: '/api/gqlPublic' }))
        
        // Catch 404 and forward to error handler
        router.use((req, res, next) => {
            const err = new Error('Not Found');
            err.status = 404;
            next(err)
        })
        
        // Error handler
        router.use((err, req, res, next) => {
            res.status(err.status || 500)
        })
        
        app.use(router)
        app.listen(PORT, () => console.log(`Listening on port ${PORT}`))
        //https.createServer(options, app).listen(3001)
    }
    catch(e) { console.log(e) }
}

init()

