import gen from 'nanoid/generate'

export const genShortId = () => {
    return gen('-+0123456789ABCDEFGHJKLMNPRTUVWXYZ', 4)
}

export const genPassword = ()=> {
	let password = ''
	const pool = '0123456789abcdefghijklmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
	const optionsLength = 8
	const strictRules = [
		{ rule: /[a-z]/ },
		{ rule: /[A-Z]/ },
		{ rule: /[0-9]/ }]
    
	for (var i = 0; i < optionsLength; i++) {
		password += pool[Math.round(Math.random() * pool.length)];
	}

	var fitsRules = strictRules.reduce(function(result, rule) {
		if (result == false) return false;
		return rule.rule.test(password);
	}, true)

	if (!fitsRules) return genPassword()
	return password
};