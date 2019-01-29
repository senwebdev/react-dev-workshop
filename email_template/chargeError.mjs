const chargeError_html = (logDoc) => {
    return `
    <p><b>Charge error occured</b></p>
    <pre>${JSON.parse(logDoc)}</pre>
    `}
    
export default chargeError_html