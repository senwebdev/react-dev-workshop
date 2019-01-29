const sendVerificationPIN_html = ({verificationPIN, uid}) => {
    return `
    <p>Thanks for joining P001!</p>
    <p>Your verification PIN is <strong>${verificationPIN}</strong>.</p>
    <p>If you already left our website, you can go back and activate <strong><a href="http://54.95.253.192:8080/userActivate/${uid}/${verificationPIN}">by Clicking here</a><strong></p>
    <p>If you encounter error by clicking the link above, please go to http://54.95.253.192:8080/userActivate, and copy and paste following information into the form:</p>
    <p>User ID: ${uid} <br />
    Verification PIN: ${verificationPIN}</p>
    `}
    
export default sendVerificationPIN_html