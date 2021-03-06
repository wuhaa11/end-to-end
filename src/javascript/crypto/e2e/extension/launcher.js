/**
 * @license
 * Copyright 2013 Google Inc. All rights reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview The launcher for the End-To-End extension. Establishes
 * communication with the content scripts. Instantiates the required UI bits
 * that allow the user to interact with the extension.
 */

goog.provide('e2e.ext.Launcher');

goog.require('e2e.ext.api.Api');
goog.require('e2e.ext.ui.preferences');
goog.require('e2e.openpgp.ContextImpl');

goog.scope(function() {
var ext = e2e.ext;
var constants = e2e.ext.constants;
var messages = e2e.ext.messages;
var preferences = e2e.ext.ui.preferences;



/**
 * Constructor for the End-To-End extension launcher.
 * @constructor
 */
ext.Launcher = function() {
  /**
   * The ID of the last used tab.
   * @type {number}
   * @private
   */
  this.lastTabId_ = window.NaN;

  /**
   * The PGP context used by the extension.
   * @type {e2e.openpgp.Context}
   * @private
   */
  this.pgpContext_ = new e2e.openpgp.ContextImpl();

  /**
   * The context API that the rest of the extension can use to communicate with
   * the PGP context.
   * @type {!ext.api.Api}
   * @private
   */
  this.ctxApi_ = new ext.api.Api();

  /**
   * Whether the launcher was started correctly.
   * @type {boolean}
   * @private
   */
  this.started_ = false;
};


/**
 * Delay in ms needed to initialize message listeners in helper.
 * @type {number}
 * @const
 */
ext.Launcher.HELPER_CALLBACK_DELAY = 50;


/**
 * Sets the provided content into the element on the page that the user has
 * selected.
 * Note: This function might not work while debugging the extension.
 * @param {string} content The content to write inside the selected element.
 * @param {!Array.<string>} recipients The recipients of the message.
 * @param {string} origin The web origin where the original message was created.
 * @param {boolean} expectMoreUpdates True if more updates are expected. False
 *     if this is the final update to the selected content.
 * @param {!function(...)} callback The function to invoke once the content has
 *     been updated.
 * @param {!function(Error)} errorCallback The callback to invoke if an error is
 *     encountered.
 * @param {string=} opt_subject The subject of the message if applicable.
 * @expose
 */
ext.Launcher.prototype.updateSelectedContent = function(content, recipients,
    origin, expectMoreUpdates, callback, errorCallback, opt_subject) {
  this.getActiveTab_(goog.bind(function(tabId) {
    chrome.tabs.sendMessage(tabId, {
      value: content,
      response: true,
      detach: !Boolean(expectMoreUpdates),
      origin: origin,
      recipients: recipients,
      subject: opt_subject
    }, function(response) {
      if (arguments.length == 0 && chrome.runtime.lastError) {
        errorCallback(new Error(chrome.runtime.lastError.message));
      } else if (response instanceof Error) {
        errorCallback(response);
      } else {
        callback(response);
      }
    });
  }, this));
};


/**
 * Retrieves the content that the user has selected.
 * @param {!function(...)} callback The callback where the selected content will
 *     be passed.
 * @param {!function(Error)} errorCallback The callback to invoke if an error is
 *     encountered.
 * @expose
 */
ext.Launcher.prototype.getSelectedContent = function(callback, errorCallback) {
  this.getActiveTab_(goog.bind(function(tabId) {
    chrome.tabs.sendMessage(tabId, {
      enableLookingGlass: preferences.isLookingGlassEnabled()
    }, function(response) {
      if (arguments.length == 0 && chrome.runtime.lastError) {
        errorCallback(new Error(chrome.runtime.lastError.message));
      } else if (response instanceof Error) {
        errorCallback(response);
      } else {
        callback(response);
      }
    });
  }, this));
};


/**
 * Finds the current active tab and determines if a helper script is running
 * inside of it. If no helper script is running, then one is injected.
 * @param {!function(...)} callback The function to invoke once the active tab
 *     is found.
 * @private
 */
ext.Launcher.prototype.getActiveTab_ = function(callback) {
  chrome.tabs.query({
    active: true,
    currentWindow: true
  }, goog.bind(function(tabs) {
    var tab = tabs[0];
    if (!goog.isDef(tab)) {
      // NOTE(radi): In some operating systems (OSX, CrOS), the query will be
      // executed against the window holding the browser action. In such
      // situations we'll provide the last used tab.
      callback(this.lastTabId_);
      return;
    } else {
      this.lastTabId_ = tab.id;
    }

    chrome.tabs.executeScript(tab.id, {file: 'helper_binary.js'}, function() {
      setTimeout(function() {
        callback(tab.id);
      }, ext.Launcher.HELPER_CALLBACK_DELAY);
    });
  }, this));
};


/**
 * Asks for the keyring passphrase and start the launcher. Will throw an
 * exception if the password is wrong.
 * @param {string=} opt_passphrase The passphrase of the keyring.
 * @expose
 */
ext.Launcher.prototype.start = function(opt_passphrase) {
  this.start_(opt_passphrase || '');
};


/**
 * Starts the launcher.
 * @param {string} passphrase The passphrase of the keyring.
 * @private
 */
ext.Launcher.prototype.start_ = function(passphrase) {
  this.pgpContext_.setKeyRingPassphrase(passphrase);
  if (goog.global.chrome &&
      goog.global.chrome.runtime &&
      goog.global.chrome.runtime.getManifest) {
    var manifest = chrome.runtime.getManifest();
    this.pgpContext_.setArmorHeader(
        'Version',
        manifest.name + ' v' + manifest.version);
  }
  this.ctxApi_.installApi();
  this.started_ = true;
  preferences.initDefaults();

  this.showWelcomeScreen_();
  this.updatePassphraseWarning_();
};


/**
 * Returns the PGP context used within the extension.
 * @return {e2e.openpgp.Context} The PGP context.
 * @expose
 */
ext.Launcher.prototype.getContext = function() {
  return this.pgpContext_;
};


/**
 * Indicates if the keyring was loaded with the correct passphrase.
 * @return {boolean} True if the keyring was loaded with the correct passphrase.
 * @expose
 */
ext.Launcher.prototype.hasPassphrase = function() {
  return this.started_;
};


/**
 * Display a warning to the user if there is no available passphrase to access
 * the keyring.
 * @private
 */
ext.Launcher.prototype.updatePassphraseWarning_ = function() {
  if (this.hasPassphrase()) {
    chrome.browserAction.setBadgeText({text: ''});
    chrome.browserAction.setTitle({
      title: chrome.i18n.getMessage('extName')
    });
  } else {
    chrome.browserAction.setBadgeText({text: '!'});
    chrome.browserAction.setTitle({
      title: chrome.i18n.getMessage('passphraseEmptyWarning')
    });
  }
};


/**
 * Shows the welcome screen to first-time users.
 * @private
 */
ext.Launcher.prototype.showWelcomeScreen_ = function() {
  if (preferences.isWelcomePageEnabled()) {
    window.open('welcome.html');
  }
};

});  // goog.scope
