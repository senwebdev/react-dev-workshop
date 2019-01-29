import nodemailer from 'nodemailer'
import _ from 'lodash'
import aws from 'aws-sdk'

aws.config.update({region:'us-east-1'})

import sendVerificationPIN_html from '../email_template/sendVerificationPIN.mjs'
import chargeError_html from '../email_template/chargeError.mjs'

let mail = nodemailer.createTransport({
    SES: new aws.SES({
        apiVersion: '2010-12-01'
    })
})

/*const mail = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    auth: {
        user: 'frv6jgwjzq4qkpge@ethereal.email',
        pass: 'HrphwbPNKzMMfPv7dj'
    }
})*/

const sendMail = (profile, param, override) => {
    let infoDefault = {}
    switch(profile) {
        case 'admin':
            infoDefault = {
                from: 'hi@e.wisekeep.hk',
                subject: 'Thanks for joining P001',
                text: 'Admin testing',
                html: '<p>Admin testing</p>'
            }
            break
        case 'sendVerificationPIN':
            infoDefault = {
                from: 'hi@e.wisekeep.hk',
                to: param.to,
                subject: 'Thanks for joining P001',
                text: 'Admin testing',
                html: sendVerificationPIN_html(param)
            }
            break
        case 'chargeError':
            infoDefault = {
                from: 'hi@e.wisekeep.hk',
                to: 'hi@wisekeep.hk',
                subject: 'P001-backend Charge Error: '+ param.chargeLogId,
                text: '',
                html: chargeError_html(param.logDoc)
            }
            break
        default:
            infoDefault = {
                from: 'hi@e.wisekeep.com',
                subject: 'Thanks for joining P001',
                text: 'Admin testing',
                html: '<p>Admin testing</p>'
            }
    }
    const sendInfo = _.merge(infoDefault, override)
    mail.sendMail(sendInfo, (error, info) => {
        if (error) {
            return console.log(error);
        }
        console.log('Message sent: %s', info.messageId);
        console.log('https://ethereal.email, login: frv6jgwjzq4qkpge@ethereal.email, password: HrphwbPNKzMMfPv7dj')
    })
}


export default sendMail