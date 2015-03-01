/*
 * Copyright (c) 2013 Antoine Martin <antoine@devloop.org.uk>
 * Copyright (c) 2014 Joshua Higgins <josh@kxes.net>
 * Copyright (c) 2015 Spikes, Inc.
 * Licensed under MPL 2.0
 *
 * xpra client
 *
 * requires:
 *	xpra_protocol.js
 *  window.js
 *  keycodes.js
 */

XPRA_CLIENT_FORCE_NO_WORKER = true;

function XpraClient(container) {
	// state
	var me = this;
	this.host = null;
	this.port = null;
	this.ssl = null;
	// some client stuff
	this.OLD_ENCODING_NAMES_TO_NEW = {"x264" : "h264", "vpx" : "vp8"};
	this.RGB_FORMATS = ["RGBX", "RGBA"];
	this.caps_lock = null;
	this.alt_modifier = null;
	this.meta_modifier = null;
	// the container div is the "screen" on the HTML page where we
	// are able to draw our windows in.
	this.container = document.getElementById(container);
	if(!this.container) {
		throw "invalid container element";
	}
	// a list of our windows
	this.id_to_window = {};
	// basic window management
	this.topwindow = null;
	this.topindex = 0;
	this.focus = -1;
	// the protocol
	this.protocol = null;
	// the client holds a list of packet handlers
	this.packet_handlers = {
		'open': this._process_open,
		'startup-complete': this._process_startup_complete,
		'hello': this._process_hello,
		'ping': this._process_ping,
		'new-window': this._process_new_window,
		'new-override-redirect': this._process_new_override_redirect,
		'window-metadata': this._process_window_metadata,
		'lost-window': this._process_lost_window,
		'raise-window': this._process_raise_window,
		'window-resized': this._process_window_resized
	};
	// assign the keypress callbacks
	document.onkeydown = function (e) {
		me._keyb_onkeydown(e, me);
	};
	document.onkeyup = function (e) {
		me._keyb_onkeyup(e, me);
	};
	document.onkeypress = function (e) {
		me._keyb_onkeypress(e, me);
	};
}

XpraClient.prototype.connect = function(host, port, ssl) {
	// open the web socket, started it in a worker if available
	console.log("connecting to xpra server " + host + ":" + port + " with ssl: " + ssl);
	this.host = host;
	this.port = port;
	this.ssl = ssl;
	// detect websocket in webworker support and degrade gracefully
	if(window.Worker) {
		console.log("we have webworker support");
		// spawn worker that checks for a websocket
		var me = this;
		var worker = new Worker('include/wsworker_check.js');
		worker.addEventListener('message', function(e) {
			var data = e.data;
			switch (data['result']) {
				case true:
				// yey, we can use websocket in worker!
				console.log("we can use websocket in webworker");
				me._do_connect(true);
				break;
				case false:
				console.log("we can't use websocket in webworker, won't use webworkers");
				break;
				default:
				console.log("client got unknown message from worker");
			};
		}, false);
		// ask the worker to check for websocket support, when we recieve a reply
		// through the eventlistener above, _do_connect() will finish the job
		worker.postMessage({'cmd': 'check'});
	} else {
		// no webworker support
		console.log("no webworker support at all.")
	}
}

XpraClient.prototype._do_connect = function(with_worker) {
	if(with_worker && !(XPRA_CLIENT_FORCE_NO_WORKER)) {
		this.protocol = new XpraProtocolWorkerHost();
	} else {
		this.protocol = new XpraProtocol();
	}
	// set protocol to deliver packets to our packet router
	this.protocol.set_packet_handler(this._route_packet, this);
	// make uri
	var uri = "ws://";
	if (this.ssl)
		uri = "wss://";
	uri += this.host;
	uri += ":" + this.port;
	// do open
	this.protocol.open(uri);
}

XpraClient.prototype.close = function() {
	// close all windows
	// close protocol
	this.protocol.close();
}

XpraClient.prototype._route_packet = function(packet, ctx) {
	// ctx refers to `this` because we came through a callback
	var packet_type = "";
	var fn = "";
	try {
		packet_type = packet[0];
		console.log("received a " + packet_type + " packet");
		fn = ctx.packet_handlers[packet_type];
		if (fn==undefined)
			console.error("no packet handler for "+packet_type+"!");
		else
			fn(packet, ctx);
	}
	catch (e) {
		console.error("error processing '"+packet_type+"' with '"+fn+"': "+e);
		throw e;
	}
}

XpraClient.prototype._keyb_get_modifiers = function(event) {
	/**
	 * Returns the modifiers set for the current event.
	 * We get the list of modifiers using "get_event_modifiers"
	 * then translate "alt" and "meta" into their keymap name.
	 * (usually "mod1")
	 */
	//convert generic modifiers "meta" and "alt" into their x11 name:
	var modifiers = get_event_modifiers(event);
	//FIXME: look them up!
	var alt = "mod1";
	var meta = "mod1";
	var index = modifiers.indexOf("alt");
	if (index>=0)
		modifiers[index] = alt;
	index = modifiers.indexOf("meta");
	if (index>=0)
		modifiers[index] = meta;
	//show("get_modifiers() modifiers="+modifiers.toSource());
	return modifiers;
}

XpraClient.prototype._keyb_process = function(pressed, event) {
	/**
	 * Process a key event: key pressed or key released.
	 * Figure out the keycode, keyname, modifiers, etc
	 * And send the event to the server.
	 */
	// MSIE hack
	if (window.event)
		event = window.event;
	//show("processKeyEvent("+pressed+", "+event+") keyCode="+event.keyCode+", charCode="+event.charCode+", which="+event.which);

	var keyname = "";
	var keycode = 0;
	if (event.which)
		keycode = event.which;
	else
		keycode = event.keyCode;
	if (keycode in CHARCODE_TO_NAME)
		keyname = CHARCODE_TO_NAME[keycode];
	var DOM_KEY_LOCATION_RIGHT = 2;
	if (keyname.match("_L$") && event.location==DOM_KEY_LOCATION_RIGHT)
		keyname = keyname.replace("_L", "_R")

	var modifiers = this._keyb_get_modifiers(event);
	if (this.caps_lock)
		modifiers.push("lock");
	var keyval = keycode;
	var str = String.fromCharCode(event.which);
	var group = 0;

	var shift = modifiers.indexOf("shift")>=0;
	if ((this.caps_lock && shift) || (!this.caps_lock && !shift))
		str = str.toLowerCase();

	if (this.topwindow != null) {
		//show("win="+win.toSource()+", keycode="+keycode+", modifiers=["+modifiers+"], str="+str);
		var packet = ["key-action", topwindow, keyname, pressed, modifiers, keyval, str, keycode, group];
		this.protocol.send(packet);
	}
}

XpraClient.prototype._keyb_onkeydown = function(event, ctx) {
	ctx._keyb_process(true, event);
	return false;
};
XpraClient.prototype._keyb_onkeyup = function(event, ctx) {
	ctx._keyb_process(false, event);
	return false;
};

XpraClient.prototype._keyb_onkeypress = function(event, ctx) {
	/**
	 * This function is only used for figuring out the caps_lock state!
	 * onkeyup and onkeydown give us the raw keycode,
	 * whereas here we get the keycode in lowercase/uppercase depending
	 * on the caps_lock and shift state, which allows us to figure
	 * out caps_lock state since we have shift state.
	 */
	var keycode = 0;
	if (event.which)
		keycode = event.which;
	else
		keycode = event.keyCode;
	var modifiers = ctx._keyb_get_modifiers(event);

	/* PITA: this only works for keypress event... */
	caps_lock = false;
	var shift = modifiers.indexOf("shift")>=0;
	if (keycode>=97 && keycode<=122 && shift)
		caps_lock = true;
	else if (keycode>=65 && keycode<=90 && !shift)
		caps_lock = true;
	//show("caps_lock="+caps_lock);
	return false;
};

XpraClient.prototype._guess_platform_processor = function() {
	//mozilla property:
	if (navigator.oscpu)
		return navigator.oscpu;
	//ie:
	if (navigator.cpuClass)
		return navigator.cpuClass;
	return "unknown";
}

XpraClient.prototype._guess_platform_name = function() {
	//use python style strings for platforms:
	if (navigator.appVersion.indexOf("Win")!=-1)
		return "Microsoft Windows";
	if (navigator.appVersion.indexOf("Mac")!=-1)
		return "Mac OSX";
	if (navigator.appVersion.indexOf("Linux")!=-1)
		return "Linux";
	if (navigator.appVersion.indexOf("X11")!=-1)
		return "Posix";
	return "unknown";
}

XpraClient.prototype._guess_platform = function() {
	//use python style strings for platforms:
	if (navigator.appVersion.indexOf("Win")!=-1)
		return "win32";
	if (navigator.appVersion.indexOf("Mac")!=-1)
		return "darwin";
	if (navigator.appVersion.indexOf("Linux")!=-1)
		return "linux2";
	if (navigator.appVersion.indexOf("X11")!=-1)
		return "posix";
	return "unknown";
}

XpraClient.prototype._get_keyboard_layout = function() {
	//IE:
	//navigator.systemLanguage
	//navigator.browserLanguage
	var v = window.navigator.userLanguage || window.navigator.language;
	//ie: v="en_GB";
	v = v.split(",")[0];
	var l = v.split("-", 2);
	if (l.length==1)
		l = v.split("_", 2);
	if (l.length==1)
		return "";
	//ie: "gb"
	return l[1].toLowerCase();
}

XpraClient.prototype._get_keycodes = function() {
	//keycodes.append((nn(keyval), nn(name), nn(keycode), nn(group), nn(level)))
	var keycodes = [];
	var kc;
	for(var keycode in CHARCODE_TO_NAME) {
		kc = parseInt(keycode);
		keycodes.push([kc, CHARCODE_TO_NAME[keycode], kc, 0, 0]);
	}
	//show("keycodes="+keycodes.toSource());
	return keycodes;
}

XpraClient.prototype._get_desktop_size = function() {
	return [this.container.clientWidth, this.container.clientHeight];
}

XpraClient.prototype._get_DPI = function() {
	"use strict";
	var dpi_div = document.getElementById("dpi");
	if (dpi_div != undefined) {
		//show("dpiX="+dpi_div.offsetWidth+", dpiY="+dpi_div.offsetHeight);
		if (dpi_div.offsetWidth>0 && dpi_div.offsetHeight>0)
			return Math.round((dpi_div.offsetWidth + dpi_div.offsetHeight) / 2.0);
	}
	//alternative:
	if ('deviceXDPI' in screen)
		return (screen.systemXDPI + screen.systemYDPI) / 2;
	//default:
	return 96;
}

XpraClient.prototype._get_screen_sizes = function() {
	var dpi = this._get_DPI();
	var screen_size = this._get_desktop_size();
	var wmm = Math.round(screen_size[0]*25.4/dpi);
	var hmm = Math.round(screen_size[1]*25.4/dpi);
	var monitor = ["Canvas", 0, 0, screen_size[0], screen_size[1], wmm, hmm];
	var screen = ["HTML", screen_size[0], screen_size[1],
				wmm, hmm,
				[monitor],
				0, 0, screen_size[0], screen_size[1]
			];
	//just a single screen:
	return [screen];
}

XpraClient.prototype._make_hello = function() {
	return {
		"version"					: "0.15.0",
		"platform"					: this._guess_platform(),
		"platform.name"				: this._guess_platform_name(),
		"platform.processor"		: this._guess_platform_processor(),
		"platform.platform"			: navigator.appVersion,
		"namespace"			 		: true,
		"client_type"		   		: "HTML5",
		"share"						: false,
		"auto_refresh_delay"		: 500,
		"randr_notify"				: true,
		"sound.server_driven"		: true,
		"generic_window_types"		: true,
		"server-window-resize"		: true,
		"notify-startup-complete"	: true,
		"generic-rgb-encodings"		: true,
		"window.raise"				: true,
		"encodings"					: ["rgb"],
		"raw_window_icons"			: true,
		//rgb24 is not efficient in HTML so don't use it:
		//png and jpeg will need extra code
		//"encodings.core"			: ["rgb24", "rgb32", "png", "jpeg"],
		"encodings.core"			: ["rgb32"],
		"encodings.rgb_formats"	 	: this.RGB_FORMATS,
		"encoding.generic"	  		: true,
		"encoding.transparency"		: true,
		"encoding.client_options"	: true,
		"encoding.csc_atoms"		: true,
		"encoding.uses_swscale"		: false,
		//video stuff we may handle later:
		"encoding.video_reinit"		: false,
		"encoding.video_scaling"	: false,
		"encoding.csc_modes"		: [],
		//sound (not yet):
		"sound.receive"				: false,
		"sound.send"				: false,
		//compression bits:
		"zlib"						: true,
		"lz4"						: false,
		"compression_level"	 		: 1,
		"compressible_cursors"		: true,
		"encoding.rgb24zlib"		: true,
		"encoding.rgb_zlib"			: true,
		"encoding.rgb_lz4"			: false,
		"windows"					: true,
		//partial support:
		"keyboard"					: true,
		"xkbmap_layout"				: this._get_keyboard_layout(),
		"xkbmap_keycodes"			: this._get_keycodes(),
		"desktop_size"				: this._get_desktop_size(),
		"screen_sizes"				: this._get_screen_sizes(),
		"dpi"						: this._get_DPI(),
		//not handled yet, but we will:
		"clipboard_enabled"			: false,
		"notifications"				: true,
		"cursors"					: true,
		"bell"						: true,
		"system_tray"				: true,
		//we cannot handle this (GTK only):
		"named_cursors"				: false,
	};
}

/*
 * Window callbacks
 */

XpraClient.prototype._new_window = function(wid, x, y, w, h, metadata, override_redirect, client_properties) {
	// each window needs their own DIV that contains a canvas
	var mydiv = document.createElement("div");
	mydiv.id = String(wid);
	var mycanvas = document.createElement("canvas");
	mydiv.appendChild(mycanvas);
	document.body.appendChild(mydiv);
	// set initial sizes
	mycanvas.width = w;
	mycanvas.height = h;
	// create the XpraWindow object to own the new div
	var win = new XpraWindow(this, mycanvas, wid, x, y, w, h,
		metadata,
		override_redirect,
		client_properties,
		this._window_geometry_changed,
		this._window_mouse_move,
		this._window_mouse_click,
		this._window_set_focus,
		this._window_closed
		);
	this.id_to_window[wid] = win;
	var geom = win.get_internal_geometry();
	if (!override_redirect) {
		this.protocol.send(["map-window", wid, geom.x, geom.y, geom.w, geom.h, this._get_client_properties(win)]);
		this._window_set_focus(win);
	}
}

XpraClient.prototype._new_window_common = function(packet, override_redirect) {
	var wid, x, y, w, h, metadata;
	wid = packet[1];
	x = packet[2];
	y = packet[3];
	w = packet[4];
	h = packet[5];
	metadata = packet[6];
	if (wid in this.id_to_window)
		throw "we already have a window " + wid;
	if (w<=0 || h<=0) {
		console.error("window dimensions are wrong: "+w+"x"+h);
		w, h = 1, 1;
	}
	var client_properties = {}
	if (packet.length>=8)
		client_properties = packet[7];
	this._new_window(wid, x, y, w, h, metadata, override_redirect, client_properties)
}

XpraClient.prototype._window_closed = function(win) {
	win.client.protocol.send(["close-window", win.wid]);
}

XpraClient.prototype._get_client_properties = function(win) {
	var cp = win.client_properties;
	cp["encodings.rgb_formats"] = this.RGB_FORMATS;
	return cp;
}

XpraClient.prototype._window_geometry_changed = function(win) {
	// window callbacks are called from the XpraWindow function context
	// so use win.client instead of `this` to refer to the client
	var geom = win.get_internal_geometry();
	var wid = win.wid;
	
	if (!win.override_redirect) {
		win.client._window_set_focus(win);
	}
	win.client.protocol.send(["configure-window", wid, geom.x, geom.y, geom.w, geom.h, win.client._get_client_properties(win)]);
}

XpraClient.prototype._window_mouse_move = function(win, x, y, modifiers, buttons) {
	var wid = win.wid;
	win.client.protocol.send(["pointer-position", wid, [x, y], modifiers, buttons]);
}

XpraClient.prototype._window_mouse_click = function(win, button, pressed, x, y, modifiers, buttons) {
	var wid = win.wid;
	win.client._window_set_focus(win);
	win.client.protocol.send(["button-action", wid, button, pressed, [x, y], modifiers, buttons]);
}

XpraClient.prototype._window_set_focus = function(win) {
	var wid = win.wid;
	focus = wid;
	topwindow = wid;
	win.client.protocol.send(["focus", focus, []]);
	//set the focused flag on all windows:
	for (var i in win.client.id_to_window) {
		var iwin = win.client.id_to_window[i];
		iwin.focused = (i==wid);
		iwin.updateFocus();
	}
}

/*
 * packet processing functions start here 
 */

XpraClient.prototype._process_open = function(packet, ctx) {
	console.log("sending hello");
	var hello = ctx._make_hello();
	ctx.protocol.send(["hello", hello]);
}

XpraClient.prototype._process_startup_complete = function(packet, ctx) {
	console.log("startup complete");
}

XpraClient.prototype._process_hello = function(packet, ctx) {
	//show("process_hello("+packet+")");
	var hello = packet[1];
	var version = hello["version"];
	try {
		var vparts = version.split(".");
		var vno = [];
		for (var i=0; i<vparts.length;i++) {
			vno[i] = parseInt(vparts[i]);
		}
		if (vno[0]<=0 && vno[1]<10) {
			throw "unsupported version: " + version;
			this.close();
			return;
		}
	}
	catch (e) {
		throw "error parsing version number '" + version + "'";
		this.close();
		return;
	}
	console.log("got hello: server version "+version+" accepted our connection");
	//figure out "alt" and "meta" keys:
	if ("modifier_keycodes" in hello) {
		var modifier_keycodes = hello["modifier_keycodes"];
		for (var mod in modifier_keycodes) {
			//show("modifier_keycode["+mod+"]="+modifier_keycodes[mod].toSource());
			var keys = modifier_keycodes[mod];
			for (var i=0; i<keys.length; i++) {
				var key = keys[i];
				//the first value is usually the integer keycode,
				//the second one is the actual key name,
				//doesn't hurt to test both:
				for (var j=0; j<key.length; j++) {
					if ("Alt_L"==key[j])
						this.alt_modifier = mod;
					if ("Meta_L"==key[j])
						this.meta_modifier = mod;
				}
			}
		}
	}
	//show("alt="+alt_modifier+", meta="+meta_modifier);
}

XpraClient.prototype._process_ping = function(packet, ctx) {
	var echotime = packet[1];
	var l1=0, l2=0, l3=0;
	ctx.protocol.send(["ping_echo", echotime, l1, l2, l3, 0]);
}

XpraClient.prototype._process_new_window = function(packet, ctx) {
	ctx._new_window_common(packet, false);
}

XpraClient.prototype._process_new_override_redirect = function(packet, ctx) {
	ctx._new_window_common(packet, true);
}

XpraClient.prototype._process_window_metadata = function(packet, ctx) {
	var wid = packet[1],
		metadata = packet[2],
		win = ctx.id_to_window[wid];
    win.update_metadata(metadata);
}

XpraClient.prototype._process_lost_window = function(packet, ctx) {
	var wid = packet[1];
	var win = ctx.id_to_window[wid];
	if (win!=null) {
		win.destroy();
	}
}

XpraClient.prototype._process_raise_window = function(packet, ctx) {
	var wid = packet[1];
	var win = ctx.id_to_window[wid];
	if (win!=null) {
		ctx._window_set_focus(win);
	}
}

XpraClient.prototype._process_window_resized = function(packet, ctx) {
	var wid = packet[1];
	var width = packet[2];
	var height = packet[3];
	var win = ctx.id_to_window[wid];
	if (win!=null) {
		win.resize(width, height);
	}
}