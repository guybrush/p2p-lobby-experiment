var sp = require('simple-peer')
var tplIndex = require('./index.jade')
var tplLobby = require('./lobby.jade')

document.body.innerHTML = tplIndex()
requestAnimationFrame(function(){window.p2papp = new P2PApp()})

function P2PApp() {
  this.peers = {}
  this.peersConnected = []
  this.localPeerId = ''
  this.url = ''
  this.lobbyManager = new LobbyManager({p2papp:this})
  this.socket = null
  this.connect('ws://'+window.location.host)
}

P2PApp.prototype.destroyPeer = function(peerId) {
  var p = this.peers[peerId]
  if (p) p.destroy()
}

P2PApp.prototype.createPeer = function(peerId, opts) {
  opts = opts || {}
  var self = this
  var p = this.peers[peerId] = sp(opts)
  p.id = peerId
  p.on('signal',function(s){
    var type = opts.initiator ? 'signalOffer' : 'signalAnswer'
    self.socket.send(JSON.stringify({type:type,peerId:peerId,signal:s}))
  })
  p.on('error',function(err){console.error(err)})
  p.on('close',function(){
    console.error('peer closed')
    self.peers[peerId] = null
    var idx = self.peersConnected.indexOf(p)
    if (idx !== -1) self.peersConnected.splice(idx,1)
  })
  p.on('connect',function(){
    console.log('connected to '+peerId)
    self.peersConnected.push(p)
    p.send('["chat","hello '+peerId+' i am '+self.localPeerId+'"]')
    self.broadcast('["info","connectedTo","'+peerId+'"]')
  })
  p.on('data',function(d){
    console.log('data from '+peerId,d)
    var elChat = document.querySelector('.lobby.inLobby .chat .messages')
    var elMsg = document.createElement('pre')
    elMsg.innerHTML = d
    elChat.appendChild(elMsg)
  })
  return p
}

P2PApp.prototype.broadcast = function(msg) {
  for (var i=0;i<this.peersConnected.length;i++)
    this.peersConnected[i].send(msg)
}

P2PApp.prototype.connect = function(url){
  var self = this
  if (this.socket) {
    if (this.socket.readyState == 1) this.socket.disconnect()
  }
  this.url = url
  this.socket = new WebSocket(this.url)
  this.socket.onopen = function() {
    console.log('ws:open')
  }
  this.socket.onerror = function(err) {
    console.error('ws:error',err)
  }
  this.socket.onclose = function() {
    console.error('ws:close .. reconnecting')
    setTimeout(function(){self.connect(self.url)},Math.random()*4000+1000)
  }
  this.socket.onmessage = function(msg){
    var d = JSON.parse(msg.data)
    console.log('ws:msg',d)
    if (d.lobby) {
      var l = self.lobbyManager.get(d.lobby.id)
      if (!l) self.lobbyManager.add(d.lobby)
      else l.update(d.lobby)
    }
    else if (d.init) {
      self.localPeerId = d.init.id
      self.lobbyManager.setLocalPeerId(d.init.id)
      console.log('localPeerId: '+self.localPeerId)
      if (d.init.list) {
        var ids = Object.keys(d.init.list)
        for (var i=0;i<ids.length;i++) {
          var l = self.lobbyManager.get(ids[i])
          if (!l) self.lobbyManager.add(d.init.list[ids[i]])
          else l.update(d.init.list[ids[i]])
        }
      }
    }
    else if (d.type && d.type == 'signalOffer') {
      // console.log('signalOffer',d)
      var p = self.peers[d.peerId]
      if (!p) p = self.createPeer(d.peerId)
      p.signal(d.signal)
    }
    else if (d.type && d.type == 'signalAnswer') {
      // console.log('signalAnswer',d)
      var p = self.peers[d.peerId]
      if (!p) p = self.createPeer(d.peerId)
      p.signal(d.signal)
    }
  }
}

function Lobby(lm,d) {
  this.lobbyManager = lm
  this.id = d.id
  this.peers = d.peers
  this.app = {url:'',version:'',hash:''}
  this.started = d.started
  this.el = document.createElement('div')
  this.el.className = 'lobby'
  this.inLobby = this.peers.indexOf(this.lobbyManager.localPeerId) !== -1
  this.render()
}

Lobby.prototype.update = function(d) {
  if (!d.peers || !d.peers.length) {
    return this.lobbyManager.remove(this)
  }
  this.peers = d.peers
  this.started = d.started
  this.inLobby = this.peers.indexOf(this.lobbyManager.localPeerId) !== -1
  if (this.inLobby) {
    for (k in this.lobbyManager.p2papp.peers)
      if (this.peers.indexOf(k) === -1) this.lobbyManager.p2papp.destroyPeer(k)
  }
  this.render()
}

Lobby.prototype.render = function(d) {
  var self = this
  this.el.innerHTML = tplLobby({lobby:this,localPeerId:this.lobbyManager.localPeerId})
  if (this.inLobby) {
    addClass(this.el,'inLobby')
    this.el.querySelector('.leaveLobby').addEventListener('click',function(){
      self.lobbyManager.leave(self)
    })
  }
  else {
    removeClass(this.el,'inLobby')
    this.el.querySelector('.joinLobby').addEventListener('click',function(){
      self.lobbyManager.join(self)
    })
  }
}

function LobbyManager(opts) {
  var self = this
  this.p2papp = opts.p2papp
  this.peers = this.p2papp.peers
  this.lobbiesById = {}
  this.lobbies = []
  this.localPeerId = ''
  this.elLobbies = document.querySelector('#wrapper .lobbies')
  this.elCreateLobby = document.querySelector('#wrapper .createLobby')
  this.elCreateLobby.addEventListener('click',function sendCreateLobby() {
    self.p2papp.socket.send(JSON.stringify({type:'create'}))
  })
}

LobbyManager.prototype.setLocalPeerId = function(id) {
  this.localPeerId = id
}

LobbyManager.prototype.get = function(id){
  return this.lobbiesById[id]
}

LobbyManager.prototype.add = function(d){
  var l = new Lobby(this,d)
  this.lobbies.push(l)
  this.lobbiesById[l.id] = l
  this.elLobbies.appendChild(l.el)
}

LobbyManager.prototype.remove = function(l){
  var idx = this.lobbies.indexOf(l)
  if (idx !== -1) this.lobbies.splice(idx,1)
  delete this.lobbiesById[l.id]
  this.elLobbies.removeChild(l.el)
}

LobbyManager.prototype.join = function(lobby,cb) {
  console.log('join->lobby',lobby,lobby.peers.length)
  var self = this
  var todo = lobby.peers.length
  var signals = []
  for (var i=0;i<lobby.peers.length;i++) {
    createSignal(lobby.peers[i])
  }
  self.p2papp.socket.send(JSON.stringify({type:'join',lobbyId:lobby.id}))
  function createSignal(peerId) {
    if (peerId == self.localPeerId) return
    var p = self.peers[peerId]
    if (!p) p = self.p2papp.createPeer(peerId,{initiator:true})
  }
}

LobbyManager.prototype.leave = function(lobby) {
  for (var i=0;i<lobby.peers.length;i++){
    this.p2papp.destroyPeer(lobby.peers[i])
  }
  this.p2papp.socket.send(JSON.stringify({type:'leave',id:lobby.id}))
}

function addClass(el, name) {
  //if (el.classList) return el.classList.add(name)
  var arr = el.className ? el.className.split(' ') : []
  arr.push(name)
  el.className = arr.join(' ')
}

function removeClass(el, name) {
  //if (el.classList) return el.classList.remove(name)
  if (!el.className) return
  var arr = el.className.split(' ')
  var idx = arr.indexOf(name)
  if (!~idx) return
  arr.splice(idx)
  el.className = arr.join(' ')
}
