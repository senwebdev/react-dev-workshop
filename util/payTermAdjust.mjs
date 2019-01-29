import moment from 'moment'

const payTermAdjust = (payterm, date=moment()) => {
	switch(payterm) {
		case 'COD':
			return date.startOf('day')
		case 'N30':
			return moment(date).startOf('day').add(30, 'd')
		default:
			return date.startOf('day')
	}
}

export default payTermAdjust