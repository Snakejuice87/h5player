/*!
configManager parse localStorage error * @name         configManager.js
 * @description  配置统一管理脚本
 * @version      0.0.1
 * @author       xxxily
 * @date         2022/09/20 16:10
 * @github       https://github.com/xxxily
 */

/**
 * 由于h5player是针对多网页，多域名的脚本，所以每个配置项都需要单独写入和读取，
 * 而不能采用local-storage-proxy这种将所有配置项都放在一个对象里统一管理的配置模式
 * 配置项集中在一个对象里进行统管的问题在于：配置项会因为缺乏锁机制和状态同步机制而导致配置相互冲突、相互覆盖，具体表现为：
 * 当某个配置项需要变更时，整个配置对象都要被写入覆盖原来的对象，这在只打开了一个页面的情况下问题不大，但在打开了多页的情况下则存在致命的问题：
 * 所有已打开的页面都读取了一份配置到内存，一个页面更新配置后，并不能将修改的值同步到别的页面内存中去
 * 这个时候，如果另外一个页面也要修改另外一项配置，则只会修改它想修改的项，而其它项只会按照原先读取且已存在于内存的状态覆盖回去，
 * 这就会导致A页面更改了配置，切换到B页面后又被莫名地覆写回去了
 * 所以需要configManager来解决原先采用local-storage-proxy和monkeyStorageProxy管理配置产生的问题
 */

import {
  getValByPath,
  setValByPath
} from '../libs/utils/index'

/**
 * 判断localStorage是否可用
 * localStorage并不能保证100%可用，所以使用前必须进行判断，否则会导致部分网站下脚本出现异常
 * https://stackoverflow.com/questions/30481516/iframe-in-chrome-error-failed-to-read-localstorage-from-window-access-deni
 * https://cloud.tencent.com/developer/article/1803097 (当localStorage不能用时，window.localStorage为null，而不是文中的undefined)
 */
function isLocalStorageUsable () {
  return window.localStorage && window.localStorage.getItem && window.localStorage.setItem
}

/**
 * 判断GlobalStorage是否可用，目前使用的GlobalStorage是基于tampermonkey提供的相关api
 * https://www.tampermonkey.net/documentation.php?ext=dhdg#GM_setValue
 */
function isGlobalStorageUsable () {
  return window.GM_setValue && window.GM_getValue && window.GM_deleteValue && window.GM_listValues
}

/**
 * 存储干净的localStorage相关方法
 * 防止localStorage对象下的方法被改写而导致读取和写入规则不一样的问题
 */
const rawLocalStorage = (function getRawLocalStorage () {
  const localStorageApis = [
    'getItem',
    'setItem',
    'removeItem',
    'clear',
    'key'
  ]

  const rawLocalStorage = {}

  localStorageApis.forEach(apiKey => {
    if (isLocalStorageUsable()) {
      rawLocalStorage[`_${apiKey}_`] = localStorage[apiKey]
      rawLocalStorage[apiKey] = function () {
        return rawLocalStorage[`_${apiKey}_`].apply(localStorage, arguments)
      }
    } else {
      rawLocalStorage[apiKey] = function () {
        console.error('localStorage unavailable')
      }
    }
  })

  return rawLocalStorage
})()

const configPrefix = '_h5player_'
const defConfig = {
  media: {
    autoPlay: false,
    playbackRate: 1,
    volume: 1,

    /* 是否允许存储播放进度 */
    allowRestorePlayProgress: {

    },
    /* 视频播放进度映射表 */
    progress: {}
  },
  hotkeys: {},
  enhance: {
    /* 不禁用默认的调速逻辑，则在多个视频切换时，速度很容易被重置，所以该选项默认开启 */
    blockSetPlaybackRate: true,

    blockSetCurrentTime: false,
    blockSetVolume: false,
    allowExperimentFeatures: false
  },
  debug: true
}

const configManager = {
  /**
   * 将confPath转换称最终存储到localStorage或globalStorage里的键名
   * @param {String} confPath -必选，配置路径信息：例如：'enhance.blockSetPlaybackRate'
   * @returns {keyName}
   */
  getConfKeyName (confPath = '') {
    return configPrefix + confPath.replace(/\./g, '_')
  },

  /**
   * 将存储到localStorage或globalStorage里的键名转换成实际调用时候的confPath
   * @param {String} keyName -必选 存储到localStorage或globalStorage里的键名，例如：'_h5player_enhance_blockSetPlaybackRate'
   * @returns {confPath}
   */
  getConfPath (keyName = '') {
    return keyName.replace(configPrefix, '').replace(/_/g, '.')
  },

  /**
   * 根据给定的配置路径，获取相关配置信息
   * 获取顺序：LocalStorage > GlobalStorage > defConfig > null
   * @param {String} confPath -必选，配置路径信息：例如：'enhance.blockSetPlaybackRate'
   * @returns {*} 如果返回null，则表示没获取到相关配置信息
   */
  get (confPath) {
    if (typeof confPath !== 'string') {
      return null
    }

    /* 默认优先使用本地的localStorage配置 */
    const localConf = configManager.getLocalStorage(confPath)
    if (localConf !== null && localConf !== undefined) {
      return localConf
    }

    /* 如果localStorage没相关配置，则尝试使用GlobalStorage的配置 */
    const globalConf = configManager.getGlobalStorage(confPath)
    if (globalConf !== null && globalConf !== undefined) {
      return globalConf
    }

    /* 如果localStorage和GlobalStorage配置都没找到，则尝试在默认配置表里拿相关配置信息 */
    const defConfVal = getValByPath(defConfig, confPath)
    if (typeof defConfVal !== 'undefined' && defConfVal !== null) {
      return defConfVal
    }

    return null
  },

  /**
   * 将配置结果写入到localStorage或GlobalStorage
   * 写入顺序：LocalStorage > GlobalStorage
   * 无论是否写入成功都会将结果更新到defConfig里对应的配置项上
   * @param {String} confPath
   * @param {*} val
   * @returns {Boolean}
   */
  set (confPath, val) {
    if (typeof confPath !== 'string' || typeof val === 'undefined' || val === null) {
      return false
    }

    // setValByPath(defConfig, confPath, val)

    let sucStatus = false

    sucStatus = configManager.setLocalStorage(confPath, val)

    if (!sucStatus) {
      sucStatus = configManager.setGlobalStorage(confPath, val)
    }

    return sucStatus
  },

  /* 获取并列出当前所有已设定的配置项 */
  list () {
    const result = {
      localConf: configManager.listLocalStorage(),
      globalConf: configManager.listGlobalStorage(),
      defConfig
    }
    return result
  },

  /* 清除已经写入到本地存储里的配置项 */
  clear () {
    configManager.clearLocalStorage()
    configManager.clearGlobalStorage()
  },

  /**
   * 根据给定的配置路径，获取LocalStorage下定义的配置信息
   * @param {String} confPath -必选，配置路径信息
   * @returns
   */
  getLocalStorage (confPath) {
    if (typeof confPath !== 'string') {
      return null
    }

    const key = configManager.getConfKeyName(confPath)

    if (isLocalStorageUsable()) {
      let localConf = rawLocalStorage.getItem(key)
      if (localConf !== null && localConf !== undefined) {
        try {
          localConf = JSON.parse(localConf)
        } catch (e) {
          console.error('configManager parse localStorage error:', key, localConf)
        }

        return localConf
      }
    }

    return null
  },

  /**
   * 根据给定的配置路径，获取GlobalStorage下定义的配置信息
   * @param {String} confPath -必选，配置路径信息
   * @returns
   */
  getGlobalStorage (confPath) {
    if (typeof confPath !== 'string') {
      return null
    }

    const key = configManager.getConfKeyName(confPath)

    if (isGlobalStorageUsable()) {
      const globalConf = window.GM_getValue(key)
      if (globalConf !== null && globalConf !== undefined) {
        return globalConf
      }
    }

    return null
  },

  /**
   * 将配置结果写入到localStorage里
   * @param {String} confPath
   * @param {*} val
   * @returns {Boolean}
   */
  setLocalStorage (confPath, val) {
    if (typeof confPath !== 'string' || typeof val === 'undefined' || val === null) {
      return false
    }

    setValByPath(defConfig, confPath, val)

    const key = configManager.getConfKeyName(confPath)

    if (isLocalStorageUsable()) {
      try {
        if (Object.prototype.toString.call(val) === '[object Object]' || Array.isArray(val)) {
          val = JSON.stringify(val)
        }

        rawLocalStorage.setItem(key, val)

        return true
      } catch (e) {
        console.error('configManager set localStorage error:', key, val, e)
        return false
      }
    } else {
      return false
    }
  },

  /**
   * 将配置结果写入到globalStorage里
   * @param {String} confPath
   * @param {*} val
   * @returns {Boolean}
   */
  setGlobalStorage (confPath, val) {
    if (typeof confPath !== 'string' || typeof val === 'undefined' || val === null) {
      return false
    }

    setValByPath(defConfig, confPath, val)

    const key = configManager.getConfKeyName(confPath)

    if (isGlobalStorageUsable()) {
      try {
        window.GM_setValue(key, val)
        return true
      } catch (e) {
        console.error('configManager set globalStorage error:', key, val, e)
        return false
      }
    } else {
      return false
    }
  },

  listLocalStorage () {
    if (isLocalStorageUsable()) {
      const result = {}
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith(configPrefix)) {
          const confPath = configManager.getConfPath(key)
          result[confPath] = configManager.getLocalStorage(confPath)
        }
      })
      return result
    } else {
      return {}
    }
  },

  listGlobalStorage () {
    if (isGlobalStorageUsable()) {
      const result = {}
      const globalStorage = window.GM_listValues()
      globalStorage.forEach(key => {
        if (key.startsWith(configPrefix)) {
          const confPath = configManager.getConfPath(key)
          result[confPath] = configManager.getGlobalStorage(confPath)
        }
      })
      return result
    } else {
      return {}
    }
  },

  clearLocalStorage () {
    if (isLocalStorageUsable()) {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith(configPrefix)) {
          rawLocalStorage.removeItem(key)
        }
      })
    }
  },

  clearGlobalStorage () {
    if (isGlobalStorageUsable()) {
      const globalStorage = window.GM_listValues()
      globalStorage.forEach(key => {
        if (key.startsWith(configPrefix)) {
          window.GM_deleteValue(key)
        }
      })
    }
  }
}

export default configManager
