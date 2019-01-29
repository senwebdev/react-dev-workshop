export const handleStripeError = (e) => {
	switch(e.type) {
		case 'StripeCardError':
			return parseCardError(e.raw)
			
	}
}

const parseCardError = (e) => {
	switch(e.code) {
		case 'expired_card':
			return {message: "SPECIAL", data: {errmsg: "Your card is expired"}}
		case 'incorrect_cvc':
			return {message: "SPECIAL", data: {errmsg: "Your CVC code is incorrect"}}
		case 'processing_error':
			return {message: "SPECIAL", data: {errmsg: "Stripe processing error"}}
		case 'incorrect_number':
			return {message: "SPECIAL", data: {errmsg: "Your card number is invalid."}}
		case 'card_declined':
			return {message: "SPECIAL", data: {errmsg: "Your card is declined"}}
		default:
			console.log(e)
	}
}