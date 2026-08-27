/* Shared constants. Loaded as a plain script in the service worker,
   content scripts and the popup; attaches to globalThis.LCT. */
(function (root) {
  const LCT = (root.LCT = root.LCT || {});

  LCT.MSG_SOURCE = 'LCT';

  LCT.MSG = {
    COMMENT_CREATED: 'comment_created',
    SET_DEBUG: 'set_debug',
    GET_SUMMARY: 'get_summary',
    ADJUST: 'adjust',
    SET_SETTING: 'set_setting',
    SUMMARY_UPDATED: 'summary_updated',
  };

  LCT.STORAGE_KEY = 'lct';
  LCT.SCHEMA_VERSION = 1;

  /** How many recent event ids to remember for de-duplication. */
  LCT.MAX_SEEN_IDS = 200;
  /** Day buckets older than this are dropped on startup. */
  LCT.RETENTION_DAYS = 400;

  LCT.DEFAULT_SETTINGS = {
    weekStart: 1, // 0 = Sunday, 1 = Monday
    widgetEnabled: true,
    widgetPos: null, // {x, y} in px from the left/top of the viewport
    widgetCollapsed: false,
    debug: false,
  };
})(typeof self !== 'undefined' ? self : globalThis);
