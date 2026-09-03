// App entry. WeChat DevTools requires an app.js for the onLaunch handshake;
// without it, the IDE logs a `routeTo appLaunch timeout` yellow warning
// even though pages still render from app.json.
App({
  onLaunch() {
    // No bootstrap needed for the Routine Timer MVP.
  },
});
