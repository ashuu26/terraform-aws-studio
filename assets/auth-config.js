// Firebase Authentication settings for the landing page, login page and studios.
// Fill these in from Firebase console > Project settings > General > Your apps > Web app.
// These values are public identifiers, not secrets; access is controlled by the
// providers you enable and the authorized domains you list in the Firebase console.
// See README.md > "Sign-in (Google and GitHub)" for the full setup.
window.TF_STUDIO_AUTH = {
  firebase: {
    apiKey: 'AIzaSyA7L_zs9Yk9Yxts4OAZ9yDXad2eyMW1SgQ',
    authDomain: 'terraform-studio-b3aeb.firebaseapp.com',
    projectId: 'terraform-studio-b3aeb',
    appId: '1:931669127584:web:22dad17408d71f984f74c5'
  },

  // Sign-in methods shown on the login page. Each must also be enabled in
  // Firebase console > Authentication > Sign-in method.
  providers: ['google', 'github'],

  // Optional allow-lists, checked after sign-in. Leave both empty to allow any account.
  // Example: allowedEmailDomains: ['softwareone.com']
  allowedEmailDomains: [],
  allowedEmails: []
};
