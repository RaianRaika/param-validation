/**
 * Created by roten on 11/20/17.
 */
'use strict';

const Context = require('./Context/index');
const ConfigLoader = require('../../Helper/index').ConfigLoader;
// private properties;
let _context = null;
const {PVError, InternalError} = require('../../Error/index');
const RequiredParamNotFound = require('../../Error/index').RequiredParamNotFound;
const RequestedParamIsNotValid = require('../../Error/index').RequestedParamIsNotValid;
const BaseValidatorPrivate = require('./BaseValidatorPrivateZone');
const BaseInterface = require('./BaseInterface');
const fs = require('fs');

/**
 * @description Abstract Middleware Validator Implementation.
 */
class BaseValidator extends BaseInterface {
  /**
   *
   * @param {T} app Target web app.
   * @param {JSON} config Param Validator config.
   */
  constructor(app, config) {
    super();
    const appRoutes = this.loadAppRouteConfig(app) || {};
    const {routeConfig, moduleConfig} = new ConfigLoader(config);
    _context = new Context(appRoutes, routeConfig, moduleConfig);
  }

  /**
   * @desc Get access to private methods.
   * @return {BaseValidatorPrivate}
   */
  get private() {
    return BaseValidatorPrivate;
  }

  /**
   * @desc Get access to app context.
   * @return {context}
   */
  get context() {
    return _context;
  }

  /**
   * @param {context} value
   */
  set context(value) {
    _context = value;
  }

  /**
   * @description Find the correct rule for the request.
   * @param {string} key
   * @param {string} method
   * @return {*}
   */
  findRule(key, method) {
    if (key && method) {
      const rule = this.context.routeConfig[key.toLowerCase()][method.toLowerCase()];
      if (!rule) {
        throw new InternalError().setDetails({
          message: 'In findRule function,the passed key and method are not valid.',
          data: {
            key: key,
            method: method,
          },
        });
      }
      return rule;
    } else {
      throw new InternalError()
        .setDetails({
          message: 'In findRule function, key or method is/are not passed correctly.',
          data: {
            key: key,
            method: method,
          },

        });
    }
  }

  /**
   * @desc Execute rule on a param sets.
   * @param {Object } rule A param validator rule.
   * @param {JSON} params a json object that contain the requested params.
   * @throws {PVError} an extended error based PVError. if any problem find in the params.
   * @return {true}
   */
  ruleExecutor(rule, params) {
    if (!rule && !params) {
      const MISSED_TAG = 'missed';
      const OK_TAG = 'ok';
      throw new InternalError().setDetails({
        message: 'rule & params are required for calling this method.',
        data: {
          rule: {
            status: !rule ? MISSED_TAG : OK_TAG,
          },
          params: {
            status: !params ? MISSED_TAG : OK_TAG,
          },
        },

      });
    }

    // Run internal Validator

    // check the required fields
    const matchRequireRes = this.private.matchRequirement(rule, params);
    if (matchRequireRes !== null) {
      let missedPath = '';
      matchRequireRes.forEach((pair) => {
        if (pair.missed) {
          missedPath += (missedPath === '' ? '' : ',') + pair.path;
        }
      });
      throw new RequiredParamNotFound().setDetails({
        message: 'Param not found but it required.',
        data: {
          missedParams: missedPath,
        },
      });
    }
    // check the fields data type
    const mathDataTypeRes = this.private.matchFieldsDataType(rule, params).filter((row) => {
      if (row[Object.keys(row)[0]].status !== undefined) {
        return row[Object.keys(row)[0]].status === false;
      } else {
        return true;
      }
    });
    if (mathDataTypeRes.length !== 0) {
      throw new RequestedParamIsNotValid()
        .setDetails({
          message: 'The listed param is not valid:',
          data: mathDataTypeRes,
        });
    }

    // check the other fields param( like length enum and etc.. )

    return true;
  }

  /**
   * @desc Basic param validator middleware.
   * @param {object} req
   * @param {object} res
   * @param {method}next
   * @return {*}
   */
  validator(req, res, next) {
    let error = null;
    try {
      // Check if the URL is excluded from param validator-logic skipp it.
      if (this.context.moduleConfig.excludePrefix !== null) {
        const rg = new RegExp(this.context.moduleConfig.excludePrefix, 'i');

        if (rg.test(req.url.toLowerCase())) {
          return;
        }
      }

      // Get request information.
      const reqInfo = this.requestParser(req);

      const rule = this.findRule(reqInfo.ruleKey, reqInfo.method);

      // Run the rule on params.
      if (this.private.isScriptBase(rule)) {
        // Run script Validator on params.
        try {
          const scriptTargetPath = require('path').resolve(this.context.moduleConfig.scriptPath, rule.SCRIPT);
          if (!fs.existsSync(scriptTargetPath)) {
            throw new InternalError().setDetails({
              message: 'The script config is not correct.',
              data: {script: rule},
            });
          }
          const res = require(scriptTargetPath).validator(reqInfo.params);
          if (res) {
            return true;
          } else {
            throw new InternalError()
              .setDetails({
                message: 'Param validator, script base validation, invalid script.\n' +
                'Should throw your error based on PVError',
                data: {},
              });
          }
        } catch (error) {
          if (error instanceof PVError) {
            throw error;
          } else {
            throw new InternalError().setDetails({
              message: 'Unhandled error happened in Script base param validator',
              data: error,
            });
          }
        }
      } else {
        /**
         * We have 4 parts to check .
         * - Body params.
         * - Header params.
         * - In Path params.
         * - Query String params.
         */

        // Check the body params.
        if (rule.BODY) {
          try {
            this.ruleExecutor(rule.BODY, reqInfo.params.body);
          } catch (error) {
            if (error instanceof PVError) {
              throw error;
            } else {
              throw new InternalError()
                .setDetails({
                  message: error.message,
                  data: error,
                });
            }
          }
        }
        // Check the Header params.
        if (rule.HEADER) {
          try {
            this.ruleExecutor(rule.HEADER, reqInfo.params.path);
          } catch (error) {
            if (error instanceof PVError) {
              throw error;
            } else {
              throw new InternalError()
                .setDetails({
                  message: error.message,
                  data: error,
                });
            }
          }
        }
        // Check the in Path params.
        if (rule.InPath) {
          try {
            this.ruleExecutor(Object.keys(rule.InPath).reduce((rules, part) => {
              rules[part.toLowerCase()] = rule.InPath[part];
              return rules;
            }, {}), reqInfo.params.path);
          } catch (error) {
            if (error instanceof PVError) {
              throw error;
            } else {
              throw new InternalError()
                .setDetails({
                  message: error.message,
                  data: error,
                });
            }
          }
        }
        // Check the query string params.
        if (rule.QueryParam) {
          try {
            this.ruleExecutor(rule.QueryParam, reqInfo.params.queryString);
          } catch (error) {
            if (error instanceof PVError) {
              throw error;
            } else {
              throw new InternalError()
                .setDetails({
                  message: error.message,
                  data: error,
                });
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof PVError) {
        error = err;
      } else {
        error = new InternalError()
          .setDetails({
            message: err.message,
            data: err,
          });
      }
    } finally {
      if (!error) {
        // Param validation passed.
        next();
      } else if (error instanceof InternalError) {
        res.status(500).json({
          error_code: 0,
          error_message: error.message,
          error_details: error.getDetails(),
        });
      } else {
        res.status(400).json({
          error_code: 0,
          error_message: error.message,
          error_details: error.getDetails(),
        });
      }
    }
  }

  /**
   *
   * @param {Object} req a valid sails/Express request.
   * @return {{url: string, method: string, params: {queryString: Array, body: Array, headers: Array}}}
   *
   */
  requestParser(req) {
    const method = req.method;
    const [url, queryPart] = req.url.split('?');
    let queryString = null;
    if (queryPart) {
      const QueryString = require('querystring');
      queryString = QueryString.parse(queryPart, {decodeURIComponent: decodeURIComponent});
    }
    const UrlPatterns = require('url-pattern');
    const finedURL = Object.keys(this.context.routeConfig).filter((url) => {
      // Filter all rules that match to our HTTP method.
      return this.context.routeConfig[url][method.toLowerCase()];
    }).map((finedURL) => {
      const urlPatterns = new UrlPatterns(finedURL);
      return {url: url, keyURL: finedURL, extractedData: urlPatterns.match(url.toLowerCase())};
    }).filter((matchedData) => {
      return matchedData.extractedData;
    }).filter((matchedURL) => {
      const tmpURL = Object.keys(matchedURL.extractedData).reduce((tmpURL, inPathParam) => {
        return tmpURL.replace(new RegExp('\\b' + inPathParam + '\\b'), matchedURL.extractedData[inPathParam]);
      }, matchedURL.keyURL)
        .split('/(:').join('/') // Remove /(: extra characters.
        .split('(/:').join('/') // Remove (/: extra characters.
        .split(')').join('') // Remove )   extra characters.
        .split('/:').join('/'); // Remove /:  extra characters.
      return tmpURL.toLowerCase() === url.toLowerCase();
    });

    if (finedURL.length !== 1) {
      throw new InternalError().setDetails({
        message: 'The URL in request not match with any of our routeConfig.',
        data: {
          routeConfig: this.context.routeConfig,
          requestedURL: req.url,
          requestedMethod: req.method,
        },
      });
    }
    // encode url param components
    let inPathParam = null;
    if (finedURL[0].extractedData) {
      inPathParam = Object.entries(finedURL[0].extractedData).reduce((p, v) => {
        p[v[0]] = decodeURIComponent(v[1]);
        return p;
      }, {});
    }
    return {
      url: url,
      method: method,
      ruleKey: finedURL[0].keyURL,
      params: {
        queryString: queryString || null,
        path: inPathParam,
        body: req.body || null,
        headers: req.headers || null,
      },
    };
  }
}

module.exports = BaseValidator;
