'use strict'

const os = require('os')
const path = require('path')
const chalk = require('chalk')
const stream = require('stream')
const yyyymmdd = require('yyyy-mm-dd')
const stripAnsi = require('strip-ansi')

const LEVELS = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal'
}

const INDENT = '  '
const PADDING = '        '
const SEPARATOR = os.EOL + os.EOL
const NEXT_LINE = os.EOL === '\n' ? '\r\v' : os.EOL

function time (c) {
  return c.dim(`at ${ yyyymmdd.withTime(new Date()) }`)
}

function rightPag (str, length) {
  const add = length - stripAnsi(str).length
  for (let i = 0; i < add; i++) str += ' '
  return str
}

function labeled (c, label, color, message) {
  const labelFormat = c.bold[color].bgBlack.inverse
  const messageFormat = c.bold[color]
  const pagged = rightPag(labelFormat(label), 8)

  return `${ pagged }${ messageFormat(message) } ${ time(c) }`
}

const helpers = {

  params (c, fields) {
    let max = 0
    for (let i = 0; i < fields.length; i++) {
      const current = fields[i][0].length + 2
      if (current > max) max = current
    }
    return fields.map(field => {
      const name = field[0]
      const value = field[1]

      const start = PADDING + rightPag(`${ name }: `, max)

      if (name === 'Node ID') {
        const pos = value.indexOf(':')
        let id, random
        if (pos === -1) {
          id = ''
          random = value
        } else {
          id = value.slice(0, pos)
          random = value.slice(pos)
        }
        return start + c.bold(id) + random
      } else if (Array.isArray(value)) {
        return `${ start }[${ value.map(j => c.bold(j)).join(', ') }]`
      } else if (typeof value === 'object') {
        return start + NEXT_LINE + INDENT +
          helpers.params(c,
            Object.keys(value).map(key => [key, value[key]])
          ).split(NEXT_LINE).join(NEXT_LINE + INDENT)
      } else {
        return start + c.bold(value)
      }
    }).join(NEXT_LINE)
  },

  info (c, str) {
    return labeled(c, ' INFO ', 'green', str)
  },

  warn (c, str) {
    return labeled(c, ' WARN ', 'yellow', str)
  },

  error (c, str) {
    return labeled(c, ' ERROR ', 'red', str)
  },

  hint (c, strings) {
    return strings.map(i => PADDING + i).join(NEXT_LINE)
  },

  note (c, str) {
    return str.map(i => PADDING + c.grey(i)).join(NEXT_LINE)
  },

  prettyStackTrace (c, stacktrace, root) {
    if (root.slice(-1) !== path.sep) root += path.sep

    return stacktrace.split('\n').slice(1).map(i => {
      const m = i.match(/\s+at ([^(]+) \(([^)]+)\)/)
      if (!m || m[2].indexOf(root) !== 0) {
        return c.red(i.replace(/^\s*/, PADDING))
      } else {
        m[2] = m[2].slice(root.length)
        if (m[2].indexOf('node_modules') !== -1) {
          return c.red(`${ PADDING }at ${ m[1] } (./${ m[2] })`)
        } else {
          return c.yellow(`${ PADDING }at ${ c.bold(m[1]) } (./${ m[2] })`)
        }
      }
    }).join(NEXT_LINE)
  },

  message (strings) {
    return strings.filter(i => i !== '').join(NEXT_LINE) + SEPARATOR
  }
}

class HumanFormatter extends stream.Writable {
  constructor (options) {
    super()

    if (typeof options.color === 'undefined') {
      this.chalk = chalk
    } else {
      this.chalk = new chalk.constructor({ enabled: options.color })
    }

    this.basepath = options.basepath || process.cwd()
    this.out = options.out || process.stdout
  }

  write (record) {
    this.out.write(this.formatRecord(record))
  }

  formatRecord (rec) {
    const c = this.chalk
    let message = []

    message.push(helpers[LEVELS[rec.level]](c, rec.msg))

    if (rec.hint) {
      message = message.concat(helpers.hint(c, rec.hint))
    }

    if (rec.stacktrace) {
      message = message.concat(
        helpers.prettyStackTrace(c, rec.stacktrace, this.basepath)
      )
    }

    const params = []
    if (rec.listen) {
      params.push(['PID', rec.pid])
    }

    const blacklist = ['v', 'name', 'component', 'hostname', 'time', 'msg',
      'level', 'hint', 'stacktrace', 'note', 'pid']
    for (const key of Object.keys(rec)) {
      if (blacklist.indexOf(key) === -1) {
        const value = rec[key]
        const name = key
          .replace(/([A-Z])/g, ' $1')
          .toLowerCase()
          .split(' ')
          .map(elem => {
            if (elem === 'id') return 'ID'
            if (elem === 'ip') return 'IP'

            return elem
          })
          .join(' ')
          .replace(/^./, str => str.toUpperCase())
        params.push([name, value])
      }
    }

    message = message.concat(helpers.params(c, params))

    if (rec.note) {
      message = message.concat(helpers.note(c, rec.note))
    }

    return helpers.message(message)
  }
}

module.exports = HumanFormatter