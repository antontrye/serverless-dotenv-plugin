const dotenv = require('dotenv')
const dotenvExpand = require('dotenv-expand')
const chalk = require('chalk')
const fs = require('fs')

const errorTypes = {
  HALT: 'HALT',
}

class ServerlessPlugin {
  constructor(serverless, options) {
    this.serverless = serverless
    this.serverless.service.provider.environment =
      this.serverless.service.provider.environment || {}
    this.config =
      this.serverless.service.custom && this.serverless.service.custom['dotenv']
    this.logging =
      this.config && typeof this.config.logging !== 'undefined'
        ? this.config.logging
        : true
    this.required = (this.config && this.config.required) || {}

    this.applySchemaExtensions()
    this.loadEnv(this.getEnvironment(options))
  }

  applySchemaExtensions() {
    this.serverless.configSchemaHandler.defineFunctionProperties(
      this.serverless.service.provider.name, {
        properties: {
          'dotenv': {
            type: 'object', properties: {
              'environment': { type: 'array' },
            },
          },
        },
      })
  }

  /**
   * @param {Object} options
   * @returns {string}
   */
  getEnvironment(options) {
    return process.env.NODE_ENV || options.env || options.stage || 'development'
  }

  /**
   * @param {string} env
   * @returns {string[]}
   */
  resolveEnvFileNames(env) {
    if (this.config && this.config.path) {
      if (Array.isArray(this.config.path)) {
        return this.config.path
      }
      return [this.config.path]
    }

    // https://github.com/bkeepers/dotenv#what-other-env-files-can-i-use
    const dotenvFiles = [
      `.env.${env}.local`,
      `.env.${env}`,
      // Don't include `.env.local` for `test` environment
      // since normally you expect tests to produce the same
      // results for everyone
      env !== 'test' && `.env.local`,
      `.env`,
    ]

    const basePath =
      this.config && this.config.basePath ? this.config.basePath : ''

    const filesNames = dotenvFiles.map((file) => basePath + file)

    return filesNames.filter((fileName) => fs.existsSync(fileName))
  }

  /**
   * @param {string} env
   */
  loadEnv(env) {
    const envFileNames = this.resolveEnvFileNames(env)
    try {
      const envVarsArray = envFileNames.map(
        (fileName) => dotenvExpand(dotenv.config({ path: fileName })).parsed,
      )

      const envVars = envVarsArray.reduce(
        (acc, curr) => ({ ...acc, ...curr }),
        {},
      )

      let include = false
      let exclude = false

      if (this.config && this.config.include) {
        include = this.config.include
      }

      if (this.config && this.config.exclude && !include) {
        // Don't allow both include and exclude to be specified
        exclude = this.config.exclude
      }

      if (envFileNames.length > 0) {
        if (this.logging) {
          this.serverless.cli.log(
            'DOTENV: Loading environment variables from ' +
              envFileNames.reverse().join(', ') +
              ':',
          )
        }
        if (include) {
          Object.keys(envVars)
            .filter((key) => !include.includes(key))
            .forEach((key) => {
              delete envVars[key]
            })
        }
        if (exclude) {
          Object.keys(envVars)
            .filter((key) => exclude.includes(key))
            .forEach((key) => {
              delete envVars[key]
            })
        }

        if (this.config.separate) {
          Object.entries(this.serverless.service.functions)
            // ignore without envWhitelist
            .filter(([key, fn]) => fn['dotenv'] && fn['dotenv']['environment'])
            // populate functionName.environment object with envKey and envValue from envWhitelist
            .forEach(([key, fn]) => {
              const envWhitelist = fn['dotenv']['environment']
              this.serverless.service.functions[key].environment =
                envWhitelist.reduce((fnEnvironment, whiteListedKey) => {
                  fnEnvironment[whiteListedKey] = envVars[whiteListedKey]
                  return fnEnvironment
                }, fn.environment || {})
            })
        } else {
          Object.keys(envVars).forEach((key) => {
            if (this.logging) {
              this.serverless.cli.log('\t - ' + key)
            }
            this.serverless.service.provider.environment[key] = envVars[key]
          })
        }

      } else {
        const errorMsg = 'DOTENV: Could not find .env file.'

        if (this.required.file === true) {
          throw Object.assign(new Error(errorMsg), { type: errorTypes.HALT })
        } else if (this.logging) {
          this.serverless.cli.log('DOTENV: Could not find .env file.')
        }
      }
    } catch (e) {
      if (e.type === errorTypes.HALT) {
        throw e
      }

      console.error(
        chalk.red(
          '\n Serverless Plugin Error --------------------------------------\n',
        ),
      )
      console.error(chalk.red('  ' + e.message))
    }
  }
}

module.exports = ServerlessPlugin
