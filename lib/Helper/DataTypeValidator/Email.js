/**
 * Created by roten on 11/20/17.
 */
'use strict';

const regexParamValidator = require('../validator-logic/regexParamValidator');
const validateEmail = require('../validator-logic/validateEmail');

module.exports = function(paramConfig, paramValue) {
  const res = {};
  res.requiredDataType = paramConfig.type;
  if (paramConfig['null-allowed'] && paramValue === null) {
    res.dataFormatPass = true;
    res.dataTypePassed = true;
  } else {
    res.dataTypePassed = typeof paramValue === 'string' && validateEmail(paramValue);
    res.dataFormatPass = regexParamValidator(paramConfig, paramValue);
  }
  res.status = res.dataTypePassed && res.dataFormatPass;
  return res;
};
