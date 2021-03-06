const config = require('config')
const path = require('path')
const _ = require('lodash')
const mustache = require('mustache')
const pokemonGif = require('pokemon-gif')
const geoTz = require('geo-tz')
const moment = require('moment-timezone')
const Controller = require('./controller')
const log = require('../logger')


let monsterDataPath = path.join(__dirname, '../util/monsters.json')
let moveDataPath = path.join(__dirname, '../util/moves.json')
if (_.includes(['de', 'fr', 'ja', 'ko', 'ru'], config.locale.language.toLowerCase())) {
	monsterDataPath = path.join(__dirname, `../util/locale/monsters${config.locale.language.toLowerCase()}.json`)
	moveDataPath = path.join(__dirname, `../util/locale/moves${config.locale.language.toLowerCase()}.json`)
}

const types = require('../util/types')
const emojiData = require('../../config/emoji')

const monsterData = require(monsterDataPath)
const weatherData = require('../util/weather')

const moveData = require(moveDataPath)
const formData = require('../util/forms')
const genderData = require('../util/genders')

require('moment-precise-range-plugin')

moment.locale(config.locale.timeformat)
const minTth = config.general.monsterMinimumTimeTillHidden || 0

class Monster extends Controller {

	async monsterWhoCares(data) {
		return new Promise((resolve) => {
			let areastring = `humans.area like '%"${data.matched[0] || 'doesntexist'}"%' `
			data.matched.forEach((area) => {
				areastring = areastring.concat(`or humans.area like '%"${area}"%' `)
			})
			const query = `
			select humans.id, humans.name, monsters.template from monsters
            join humans on humans.id = monsters.id
            where humans.enabled = 1 and
            pokemon_id=${data.pokemon_id} and
            min_iv<=${data.iv} and
            max_iv>=${data.iv} and
            min_cp<=${data.cp} and
            max_cp>=${data.cp} and
            (gender = ${data.gender} or gender = 0) and
            (form = ${data.form} or form = 0) and
            min_level<=${data.pokemon_level} and
            max_level>=${data.pokemon_level} and
            atk<=${data.individual_attack} and
            def<=${data.individual_defense} and
            sta<=${data.individual_stamina} and
			maxAtk>=${data.individual_attack} and
            maxDef>=${data.individual_defense} and
            maxSta>=${data.individual_stamina} and
            min_weight<=${data.weight} * 1000 and
            max_weight>=${data.weight} * 1000 and
            (round( 6371000 * acos( cos( radians(${data.latitude}) )
              * cos( radians( humans.latitude ) )
              * cos( radians( humans.longitude ) - radians(${data.longitude}) )
              + sin( radians(${data.latitude}) )
              * sin( radians( humans.latitude ) ) ) < monsters.distance and monsters.distance != 0) or
               monsters.distance = 0 and (${areastring}))
               group by humans.id, humans.name, monsters.template `


			log.log({ level: 'debug', message: 'monsterWhoCares query', event: 'sql:monsterWhoCares' })
			this.db.query(query)
				.then((result) => {
					log.info(`${data.name} appeared and ${result[0].length} humans cared`)
					resolve(result[0])
				})
				.catch((err) => {
					log.error(`monsterWhoCares errored with: ${err}`)
				})
		})
	}

	findIvColor(iv) {

		// it must be perfect if none of the ifs kick in
		// orange / legendary
		let colorIdx = 5

		if (iv < 25) colorIdx = 0 // gray / trash / missing
		else if (iv < 50) colorIdx = 1 // white / common
		else if (iv < 82) colorIdx = 2 // green / uncommon
		else if (iv < 90) colorIdx = 3 // blue / rare
		else if (iv < 100) colorIdx = 4 // purple epic

		return parseInt(this.ivColorData[colorIdx].replace(/^#/, ''), 16)
	}

	async handle(data) {
		return new Promise((resolve) => {
			switch (config.geocoding.staticProvider.toLowerCase()) {
				case 'google': {
					data.staticmap = `https://maps.googleapis.com/maps/api/staticmap?center=${data.latitude},${data.longitude}&markers=color:red|${data.latitude},${data.longitude}&maptype=${config.geocoding.type}&zoom=${config.geocoding.zoom}&size=${config.geocoding.width}x${config.geocoding.height}&key=${_.sample(config.geocoding.staticKey)}`
					break
				}
				case 'poracle': {
					data.staticmap = `https://tiles.poracle.world/static/${config.geocoding.type}/${data.latitude.toString().substring(0, 8)}/${data.longitude.toString().substring(0, 8)}/${config.geocoding.zoom}/${config.geocoding.width}/${config.geocoding.height}/${config.geocoding.scale}/png`
					break
				}
				case 'osm': {
					data.staticmap = `https://www.mapquestapi.com/staticmap/v5/map?locations=${data.latitude},${data.longitude}&size=${config.geocoding.width},${config.geocoding.height}&defaultMarker=marker-md-3B5998-22407F&zoom=${config.geocoding.zoom}&key=${_.sample(config.geocoding.staticKey)}`
					break
				}
				case 'mapbox': {
					data.staticmap = `https://api.mapbox.com/styles/v1/mapbox/streets-v10/static/url-https%3A%2F%2Fi.imgur.com%2FMK4NUzI.png(${data.longitude},${data.latitude})/${data.longitude},${data.latitude},${config.geocoding.zoom},0,0/${config.geocoding.width}x${config.geocoding.height}?access_token=${_.sample(config.geocoding.staticKey)}`
					break
				}
				default: {
					data.staticmap = ''
				}
			}
			const encountered = !(!(['string', 'number'].includes(typeof data.individual_attack) && (+data.individual_attack + 1))
								|| !(['string', 'number'].includes(typeof data.individual_defense) && (+data.individual_defense + 1))
								|| !(['string', 'number'].includes(typeof data.individual_stamina) && (+data.individual_stamina + 1)))


			data.name = monsterData[data.pokemon_id] && monsterData[data.pokemon_id].name ? monsterData[data.pokemon_id].name : 'errormon'
			data.formname = ''
			data.iv = encountered ? ((+data.individual_attack + +data.individual_defense + +data.individual_stamina) / 0.45).toFixed(2) : -1
			data.individual_attack = encountered ? +data.individual_attack : 0
			data.individual_defense = encountered ? +data.individual_defense : 0
			data.individual_stamina = encountered ? +data.individual_stamina : 0
			data.cp = encountered ? +data.cp : 0
			data.pokemon_level = encountered ? data.pokemon_level : 0
			data.move_1 = encountered ? data.move_1 : 0
			data.move_2 = encountered ? data.move_2 : 0
			data.weight = encountered ? data.weight.toFixed(2) : 0
			data.quick_move = data.weight && moveData[data.move_1] ? moveData[data.move_1].name : ''
			data.charge_move = data.weight && moveData[data.move_2] ? moveData[data.move_2].name : ''
			if (data.form === undefined || data.form === null) data.form = 0
			if (data.form) data.formname = formData[data.pokemon_id] ? formData[data.pokemon_id][data.form] : ''
			if (!data.weather) data.weather = 0
			data.move1emoji = moveData[data.move_1] && moveData[data.move_1].type ? types[moveData[data.move_1].type].emoji : ''
			data.move2emoji = moveData[data.move_2] && moveData[data.move_2].type ? types[moveData[data.move_2].type].emoji : ''
			data.move1emoji = moveData[data.move_1] && moveData[data.move_1].type && emojiData.type && emojiData.type[moveData[data.move_1].type] ? emojiData.type[moveData[data.move_1].type] : data.move1emoji
			data.move2emoji = moveData[data.move_2] && moveData[data.move_2].type && emojiData.type && emojiData.type[moveData[data.move_2].type] ? emojiData.type[moveData[data.move_2].type] : data.move2emoji
			data.boost = weatherData[data.weather].name ? weatherData[data.weather].name : ''
			data.boostemoji = emojiData.weather[data.weather]
			data.applemap = `https://maps.apple.com/maps?daddr=${data.latitude},${data.longitude}`
			data.mapurl = `https://www.google.com/maps/search/?api=1&query=${data.latitude},${data.longitude}`
			data.color = monsterData[data.pokemon_id] && monsterData[data.pokemon_id].types[0] ? types[monsterData[data.pokemon_id].types[0]].color : 0
			data.ivcolor = this.findIvColor(data.iv)
			data.tth = moment.preciseDiff(Date.now(), data.disappear_time * 1000, true)
			data.distime = moment(data.disappear_time * 1000).tz(geoTz(data.latitude, data.longitude).toString()).format(config.locale.time)
			data.gif = monsterData[data.pokemon_id] ? pokemonGif(Number(data.pokemon_id)) : pokemonGif(129)
			data.imgurl = `${config.general.imgurl}pokemon_icon_${data.pokemon_id.toString().padStart(3, '0')}_${data.form ? data.form.toString() : '00'}.png`
			data.sticker = `${config.telegram.stickerurl}pokemon_icon_${data.pokemon_id.toString().padStart(3, '0')}_${data.form ? data.form.toString() : '00'}.webp`
			const e = []
			if (monsterData[data.pokemon_id]) {
				monsterData[data.pokemon_id].types.forEach((type) => {
					e.push(emojiData.type[type])
				})

			}
			else {
				log.warning('Was unable to pull monster, the data I have is:', data)
			}
			data.emoji = e
			data.emojiString = e.join('')

			// Stop handling if it already disappeared or is about to go away
			if (data.tth.firstDateWasLater || ((data.tth.hours * 3600) + (data.tth.minutes * 60) + data.tth.seconds) < minTth) {
				log.warn(`${data.name} already disappeared or is about to go away in: ${data.tth.hours}:${data.tth.minutes}:${data.tth.seconds}`)
				resolve([])
				return null
			}

			this.pointInArea([data.latitude, data.longitude]).then((matchedAreas) => {
				data.matched = matchedAreas
				log.log({
					level: 'debug', message: `webhook message ${data.messageId} processing`, event: 'message:start', correlationId: data.correlationId, messageId: data.messageId, type: 'pokemon', meta: data,
				})

				this.monsterWhoCares(data).then((whocares) => {
					// if noone cares or the result is not iterable, break out of processing
					if (!whocares[0]) {
						resolve([])
						return null
					}
					let discordCacheBad = true // assume the worst
					whocares.forEach((cares) => {
						const ch = this.getDiscordCache(cares.id)
						if (ch <= config.discord.limitamount + 1) discordCacheBad = false // but if anyone cares and has not exceeded cache, go on
					})
					if (discordCacheBad) {
						resolve([])
						return null
					}
					this.getAddress({ lat: data.latitude.toString().substring(0, 8), lon: data.longitude.toString().substring(0, 8) }).then((geoResult) => {

						data.staticSprite = encodeURI(JSON.stringify([
							{
								url: data.imgurl,
								height: config.geocoding.spriteHeight,
								width: config.geocoding.spriteWidth,
								x_offset: 0,
								y_offset: 0,
								latitude: +data.latitude,
								longitude: +data.longitude,
							},
						]))
						if (config.geocoding.staticProvider === 'poracle') {
							data.staticmap = `${data.staticmap}?markers=${data.staticSprite}`
						}
						const jobs = []
						whocares.forEach((cares) => {
							const alarmId = this.uuid
							log.log({
								level: 'debug', message: `alarm ${alarmId} processing`, event: 'alarm:start', correlationId: data.correlationId, messageId: data.messageId, alarmId,
							})

							const caresCache = this.getDiscordCache(cares.id)
							const view = _.extend(data, {
								id: data.pokemon_id,
								time: data.distime,
								tthh: data.tth.hours,
								tthm: data.tth.minutes,
								tths: data.tth.seconds,
								confirmedTime: data.disappear_time_verified,
								name: data.name,
								now: new Date(),
								gendername: emojiData.gender && emojiData.gender[data.gender] ? emojiData.gender[data.gender] : genderData[data.gender],
								move1: data.quick_move,
								move2: data.charge_move,
								move1emoji: data.move1emoji,
								move2emoji: data.move2emoji,
								level: Math.round(data.pokemon_level),
								atk: data.individual_attack,
								def: data.individual_defense,
								sta: data.individual_stamina,
								imgurl: data.imgurl,
								pokemoji: emojiData.pokemon[data.pokemon_id],
								areas: data.matched.map((area) => area.replace(/'/gi, '').replace(/ /gi, '-')).join(', '),

								// geocode stuff
								lat: data.latitude.toString().substring(0, 8),
								lon: data.longitude.toString().substring(0, 8),
								addr: geoResult.addr,
								streetNumber: geoResult.streetNumber,
								streetName: geoResult.streetName,
								zipcode: geoResult.zipcode,
								country: geoResult.country,
								countryCode: geoResult.countryCode,
								city: geoResult.city,
								state: geoResult.state,
								stateCode: geoResult.stateCode,
								flagemoji: geoResult.flag,
								neighbourhood: geoResult.neighbourhood,
							})
							const monsterDts = data.iv === -1 && this.mdts.monsterNoIv
								? this.mdts.monsterNoIv[`${cares.template}`]
								: this.mdts.monster[`${cares.template}`]
							const template = JSON.stringify(monsterDts)
							let message = mustache.render(template, view)
							message = JSON.parse(message)

							const work = {
								lat: data.latitude.toString().substring(0, 8),
								lon: data.longitude.toString().substring(0, 8),
								sticker: data.sticker,
								message: caresCache === config.discord.limitamount + 1 ? { content: `You have reached the limit of ${config.discord.limitamount} messages over ${config.discord.limitsec} seconds` } : message,
								target: cares.id,
								name: cares.name,
								emoji: caresCache === config.discord.limitamount + 1 ? [] : data.emoji,
								meta: { correlationId: data.correlationId, messageId: data.messageId, alarmId },

							}
							if (caresCache <= config.discord.limitamount + 1) {
								jobs.push(work)
								this.addDiscordCache(cares.id)
							}

						})
						resolve(jobs)

					}).catch((err) => {
						log.log({ level: 'error', message: `getAddress errored with: ${err.message}`, event: 'fail:getAddress' })
					})
				}).catch((err) => {
					log.log({ level: 'error', message: `monsterWhoCares errored with: ${err.message}`, event: 'fail:monsterWhoCares' })
				})
			}).catch((err) => {
				log.log({ level: 'error', message: `pointsInArea errored with: ${err.message}`, event: 'fail:pointsInArea' })
			})
		})
	}
}

module.exports = Monster
