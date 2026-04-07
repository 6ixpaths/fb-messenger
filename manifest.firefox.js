export default {
  manifest_version: 2,
  name: 'FB MARKETPLACE DEV',
  version: '1.0.0',
  description: 'Filter chats',
  permissions: ["storage"],
  content_scripts: [
    {
      matches: [
        "https://www.facebook.com/marketplace/*",
        "https://www.facebook.com/messages/*",
        "https://www.messenger.com/*"
      ],
      js: ["content.js"],
      run_at: "document_idle"
    }
  ],
}
