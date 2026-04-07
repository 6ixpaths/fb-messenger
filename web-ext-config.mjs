// web-ext configuration for Firefox development
// See: https://extensionworkshop.com/documentation/develop/web-ext-configuration-file/
//
// If Firefox is not found automatically, set the path to the binary here.
// Common paths:
//   macOS (Release):   /Applications/Firefox.app/Contents/MacOS/firefox
//   macOS (Dev Ed):    /Applications/Firefox Developer Edition.app/Contents/MacOS/firefox
//   Linux:             /usr/bin/firefox
//   Windows:           C:\Program Files\Mozilla Firefox\firefox.exe

export default {
  run: {
    firefox: '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
    startUrl: ['about:debugging#/runtime/this-firefox'],
  },
}
