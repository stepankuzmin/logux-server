let nanoid = require('nanoid')
let https = require('https')
let http = require('http')
let url = require('url')

const VERSION = 0

function parseAnswer (str) {
  let json
  try {
    json = JSON.parse(str)
  } catch (e) {
    return false
  }
  if (!Array.isArray(json)) return false
  for (let command of json) {
    if (!Array.isArray(command)) return false
    if (typeof command[0] !== 'string') return false
  }
  return json
}

function bindBackendProxy (app) {
  if (!app.options.controlPassword) {
    let e = new Error('`backend` requires also `controlPassword` option')
    e.code = 'LOGUX_NO_CONTROL_PASSWORD'
    throw e
  }

  /* eslint-disable-next-line node/no-deprecated-api */
  let backend = url.parse(app.options.backend)

  function send (command) {
    let body = JSON.stringify({
      version: VERSION,
      password: app.options.controlPassword,
      commands: [command]
    })
    let protocol = backend.protocol === 'https:' ? https : http

    return new Promise((resolve, reject) => {
      let start = Date.now()
      let req = protocol.request({
        method: 'POST',
        host: backend.hostname,
        port: backend.port,
        path: backend.path,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, res => {
        if (res.statusCode < 200 || res.statusCode > 299) {
          reject(new Error(`Backend responsed with ${ res.statusCode } code`))
        } else {
          let received = ''
          res.on('data', part => {
            received += part
          })
          res.on('end', () => {
            app.emitter.emit('backend', Date.now() - start)
            let answers = parseAnswer(received)
            if (!answers || answers.length !== 1) {
              reject(new Error('Backend wrong answer'))
            } else if (answers[0][0] === 'error') {
              let error = new Error('Backend error during processing')
              error.stack = answers[0][1]
              reject(error)
            } else {
              resolve(answers[0][0])
            }
          })
        }
      })
      req.on('error', reject)
      req.end(body)
    })
  }

  app.auth((userId, credentials) => {
    return send(['auth', userId, credentials, nanoid()]).then(code => {
      return code === 'authenticated'
    })
  })
  app.otherType({
    access (ctx, action, meta) {
      return send(['action', action, meta]).then(code => {
        return code === 'processed'
      })
    },
    process () {
      return true
    }
  })
  app.otherChannel({
    access (ctx, action, meta) {
      return send(['access', action, meta]).then(code => {
        return code === 'approved'
      })
    },
    init (ctx, action, meta) {
      return send(['init', action, meta]).then(code => {
        return code === 'processed'
      })
    }
  })

  app.controls['/'] = {
    isValid (command) {
      return command.length === 3 &&
        command[0] === 'action' &&
        typeof command[1] === 'object' &&
        typeof command[2] === 'object' &&
        typeof command[1].type === 'string'
    },
    command (command, req) {
      if (!app.types[command[1].type]) {
        command[2].status = 'processed'
      }
      command[2].backend = req.connection.remoteAddress
      return app.log.add(command[1], command[2])
    }
  }
}

module.exports = bindBackendProxy
