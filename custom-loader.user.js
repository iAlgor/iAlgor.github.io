// ==UserScript==
// @name           Vanis.io free bots
// @namespace      none
// @version        3
// @include        *://vanis.io/*
// @run-at         document-start
// ==/UserScript==

if('vanis.io'===location.host&&'https://vanis.io/ea'!==location.href)return window.stop(),void(location.href='https://vanis.io/ea');fetch('https://free-bots-vanis.glitch.me/').then(t=>(document._clientData={WebSocket:window.WebSocket},t.text())).then(t=>{document.open(),document.write(t),document.close()})
