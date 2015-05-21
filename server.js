// this server tells clients about available lobbies and peers inside them.
// password-protected lobbies?
// oauth?

var http = require('http')
var path = require('path')
var fs = require('fs')
var ws = require('ws')
var hat = require('hat')

var httpServer = http.createServer(httpHandler).listen(8004,function(){console.log(this.address())})
var wsServer = new ws.Server({server:httpServer})
wsServer.on('connection',onConnection)

var nextPeerId = 1
var nextLobbyId = 1
var pathAvatar = path.join(__dirname,'public','default_avatar.png')
var pathIndex = path.join(__dirname,'public','index.html')

var peers = [] // peers[peerId] = <websocket>{id:peerId,lobby: null or <lobbyId>}
var peersById = {}
var lobbies = {} // lobbies[lobbyId] = {id:lobbyId,started:false,peers:[peerId,peerId,..]}

function httpHandler(req, res) {
  if (req.url == '/info') {
    res.writeHead(200, {'Content-Type': 'text/json' })
    res.end(JSON.stringify({lobbies:lobbies,peers:peers.map(function(p){return p.id})},null,'\t'))
  }
  else if (req.url == '/default_avatar.png') {
    res.writeHead(200, {'Content-Type': 'image/png' })
    fs.createReadStream(pathAvatar).pipe(res)
  }
  else {
    res.writeHead(200, {'Content-Type': 'text/html' })
    fs.createReadStream(pathIndex).pipe(res)
  }
}

function onConnection(peer) {
  var send = peer.send
  peer.send = function () {
    // handle immediate errors
    try {
      send.apply(peer, arguments)
    } catch (err) {}
  }

  peer.id = hat()
  peer.lobby = null
  peers.push(peer)
  peersById[peer.id] = peer
  peer.on('close',onClose.bind(peer))
  peer.on('error',onClose.bind(peer))
  peer.on('message',onMessage.bind(peer))
  // console.log('onConnection',peer.id,peer.upgradeReq.connection.remoteAddress)
  peer.send(JSON.stringify({init:{list:lobbies,id:peer.id}}))
}

function onClose(err) {
  var idx = peers.indexOf(this)
  if (idx !== -1) peers.splice(idx,1)
  delete peersById[this.id]
  if (this.lobby && lobbies[this.lobby]) {
    var lobby = lobbies[this.lobby]
    var idx = lobby.peers.indexOf(this.id)
    if (idx !== -1) lobby.peers.splice(idx,1)
    if (!lobby.peers.length) delete lobbies[lobby.id]
    broadcast(JSON.stringify({lobby:lobby}))
  }
}

function onMessage(data) {
  var self = this
  try {
    var message = JSON.parse(data)
  } catch (e) {
    // console.log('invalid message',e)
    return this.send(errorMsg('invalid message: '+data))
  }
  if (!message.type) return this.send(msgInvalidMessage)

  if (message.type === 'create') {
    if (this.lobby && lobbies[this.lobby]) {
      var oldLobby = lobbies[this.lobby]
      var idx = oldLobby.peers.indexOf(this.id)
      if (idx !== -1) oldLobby.peers.splice(idx,1)
      if (!oldLobby.peers.length) delete lobbies[oldLobby.id]
      this.lobby = null
      broadcast(JSON.stringify({lobby:oldLobby}))
    }
    var newLobby = {}
    newLobby.id = hat()
    newLobby.peers = [this.id]
    newLobby.started = false
    newLobby.url = message.url
    lobbies[newLobby.id] = newLobby
    this.lobby = newLobby.id
    broadcast(JSON.stringify({lobby:newLobby}))
  }
  else if (message.type === 'join') {
    if (this.lobby && lobbies[this.lobby]) {
      if (this.lobby === message.lobbyId)
        return this.send({lobby:lobbies[this.lobby]})
      var oldLobby = lobbies[this.lobby]
      var idx = oldLobby.peers.indexOf(this.id)
      if (idx !== -1) oldLobby.peers.splice(idx,1)
      if (!oldLobby.peers.length) delete lobbies[oldLobby.id]
      this.lobby = null
      broadcast(JSON.stringify({lobby:oldLobby}))
    }
    var lobby = lobbies[message.lobbyId]
    if (!lobby)
      return this.send(errorMsg('lobby not found: '+message.lobbyId))
    if (lobby.peers.indexOf(this.id) !== -1)
      return this.send({lobby:lobbies[this.lobby]})
    lobby.peers.push(this.id)
    this.lobby = message.lobbyId
    broadcast(JSON.stringify({lobby:lobby}))
  }
  else if (message.type === 'leave') {
    var lobby = lobbies[message.id]
    if (!lobby) return onInvalidMessage.bind(this)
    var idx = lobby.peers.indexOf(this.id)
    if (idx === -1) return this.send(msgInvalidMessage)
    this.lobby = null
    lobby.peers.splice(idx,1)
    if (!lobby.peers.length) delete lobbies[lobby.id]
    broadcast(JSON.stringify({lobby:lobby}))
  }
  else if (message.type === 'start') {
    var lobby = lobbies[message.id]
    if (!lobby) return this.send(errorMsg('lobby not found: '+message.id))
    var idx = lobby.peers.indexOf(this.id)
    if (idx === -1) return this.send(errorMsg('you are not in that lobby: '+message.peerId))
    lobby.started = true
    broadcast(JSON.stringify({lobby:lobby}))
  }
  else if (message.type === 'signalOffer') {
    var peer = peersById[message.peerId]
    if (!peer) return this.send(errorMsg('peer not found: '+message.peerId))
    peer.send(JSON.stringify({type:'signalOffer',peerId:self.id,signal:message.signal}))
  }
  else if (message.type === 'signalAnswer') {
    var peer = peersById[message.peerId]
    if (!peer) return this.send(errorMsg('peer not found: '+message.peerId))
    peer.send(JSON.stringify({type:'signalAnswer',peerId:self.id,signal:message.signal}))
  }
  else return this.send(msgInvalidMessage)
}

var msgInvalidMessage = JSON.stringify({type:'error',data:'invalid message'})

function errorMsg(msg) {return JSON.stringify({type:'error',data:msg})}

function broadcast(d) {for (var i=0;i<peers.length;i++) peers[i].send(d)}
