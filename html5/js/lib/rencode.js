/*
 * Copyright (c) 2021 Antoine Martin <antoine@xpra.org>
 */

var RENCODE = {
	DEFAULT_FLOAT_BITS : 32,
	MAX_INT_LENGTH : 64,

	CHR_LIST	: 59,
	CHR_DICT	: 60,
	CHR_INT 	: 61,
	CHR_INT1	: 62,
	CHR_INT2	: 63,
	CHR_INT4	: 64,
	CHR_INT8	: 65,
	CHR_FLOAT32	: 66,
	CHR_FLOAT64	: 44,
	CHR_TRUE	: 67,
	CHR_FALSE	: 68,
	CHR_NONE	: 69,
	CHR_TERM	: 127,

	INT_POS_FIXED_START : 0,
	INT_POS_FIXED_COUNT : 44,

	DICT_FIXED_START : 102,
	DICT_FIXED_COUNT : 25,

	INT_NEG_FIXED_START : 70,
	INT_NEG_FIXED_COUNT : 32,

	STR_FIXED_START : 128,
	STR_FIXED_COUNT : 64,

	LIST_FIXED_START : 128+64,	//STR_FIXED_START + STR_FIXED_COUNT,
	LIST_FIXED_COUNT : 64,
};


function rencode_string(str) {
	const len = str.length;
    if (len < RENCODE.STR_FIXED_COUNT) {
		const u8a = new Uint8Array(len+1);
		u8a[0] = RENCODE.STR_FIXED_START+len;
		for (let i=0; i<len; ++i) {
			u8a[i+1] = str.charCodeAt(i);
		}
		return u8a;
	}
	const len_str = len.toString();
	const len_len = len_str.length;
	const u8a = new Uint8Array(len_len+1+len);
	for (let i=0; i<len_len; ++i) {
		u8a[i] = len_str.charCodeAt(i);
	}
	const SEPARATOR = ":";
	u8a[len_len] = SEPARATOR.charCodeAt(0);
	for (let i=0; i<len_str; ++i) {
		u8a[len_len+1+i] = str.charCodeAt(i);
	}
	return u8a;
}

function rencode_int(i) {
	let u8a = null;
    if (0 <= i && i < RENCODE.INT_POS_FIXED_COUNT) {
		u8a = new Uint8Array([RENCODE.INT_POS_FIXED_START + i])
	}
	else if (-RENCODE.INT_NEG_FIXED_COUNT <= i && i < 0) {
		u8a = new Uint8Array([RENCODE.INT_NEG_FIXED_START - 1 -i])
	}
	else if (-128 <= i && i < 128) {
		u8a = new Uint8Array([RENCODE.CHR_INT1, i]);
	}
	else if (-32768 <= i && i < 32768) {
		u8a = new Uint8Array([RENCODE.CHR_INT2, Math.floor(i/256) % 256, i%256]);
	}
	else if (-2147483648 <= i && i< 2147483648) {
		u8a = new Uint8Array(5);
		u8a[0] = RENCODE.CHR_INT4;
		u8a[1] = Math.floor(i/256/256/256);
		u8a[2] = Math.floor(i/256/256) % 256;
		u8a[3] = Math.floor(i/256) % 256;
		u8a[4] = i%256;
	}
	else if (-9223372036854775808 <= i && i < 9223372036854775808) {
		u8a = new Uint8Array(9);
		u8a[0] = RENCODE.CHR_INT8;
		for (let j=0; j<8; ++j) {
			u8a[8-j] = i%256;
			i = Math.floor(i/256);
		}
	}
	else {
        const str = i.toString();
		if (str.length >= RENCODE.MAX_INT_LENGTH) {
			throw "number too big: "+i;
		}
		const str_len = str.length;
		u8a = new Uint8Array(str_len+2);
		u8a[0] = RENCODE.CHR_INT;
		for (let j=0; j<str_len; ++j) {
			u8a[1+j] = str[j];
		}
		u8a[str_len+1] = RENCODE.CHR_TERM;
	}
	return u8a;
}


function rencode_merge_arrays(rlist) {
	let len = 0;
	for (let i=0; i<rlist.length; ++i) {
		len += rlist[i].length;
	}
	const u8a = new Uint8Array(len);
	let index = 0;
	for (let i=0; i<rlist.length; ++i) {
		u8a.set(rlist[i], index);
		index += rlist[i].length;
	}
	return u8a;
}

function rencode_uint8(a) {
	const len = a.length;
    if (len < RENCODE.STR_FIXED_COUNT) {
		const u8a = new Uint8Array(len+1);
		u8a[0] = RENCODE.STR_FIXED_START+len;
		u8a.set(a, 1);
		return u8a;
	}
	const len_str = len.toString();
	const len_len = len_str.length;
	const u8a = new Uint8Array(len_len+1+len);
	for (let i=0; i<len_len; ++i) {
		u8a[i] = len_str.charCodeAt(i);
	}
	const SEPARATOR = ":";
	u8a[len_len] = SEPARATOR.charCodeAt(0);
	u8a.set(a, len_len+1);
	return u8a;
	
}

function rencode_list(l) {
	const list_len = l.length;
	const rlist = [];
    if (list_len < RENCODE.LIST_FIXED_COUNT) {
		rlist.push(new Uint8Array([RENCODE.LIST_FIXED_START + list_len]));
		for (let i=0; i<list_len; ++i) {
			rlist.push(rencode(l[i]));
		}
	}
    else {
		rlist.push(new Uint8Array([RENCODE.CHR_LIST]));
		for (let i=0; i<list_len; ++i) {
			rlist.push(rencode(l[i]));
		}
		rlist.push(new Uint8Array([RENCODE.CHR_TERM]));
	}
	return rencode_merge_arrays(rlist);
}

function rencode_dict(dict) {
	const dict_len = Object.keys(dict).length;
	const rlist = [];
	if (dict_len < RENCODE.DICT_FIXED_COUNT) {
		rlist.push(new Uint8Array([RENCODE.DICT_FIXED_START + dict_len]));
	    for(key in dict) {
			value = dict[key];
			rlist.push(rencode(key));
			rlist.push(rencode(value));
		}
	}
    else {
		rlist.push(new Uint8Array([RENCODE.CHR_DICT]));
	    for(key in dict) {
			value = dict[key];
			rlist.push(rencode(key));
			rlist.push(rencode(value));
		}
		rlist.push(new Uint8Array([RENCODE.CHR_TERM]));
	}
	return rencode_merge_arrays(rlist);
}

function rencode(obj) {
    if (obj === null || obj === undefined) {
        throw "invalid: cannot encode null";
    }
    const type = typeof obj;
    if(type === 'object') {
        if(typeof obj.length === 'undefined') {
            return rencode_dict(obj);
        }
		if(obj.constructor===Uint8Array) {
			return rencode_uint8(obj);
		}
        return rencode_list(obj);
    }
    switch(type) {
        case "string":     return rencode_string(obj);
        case "number":     return rencode_int(obj);
        case "list":       return rencode_list(obj);
        case "dictionary": return rencode_dict(obj);
        case "boolean":    return rencode_int(obj?1:0);
        default:           throw "invalid object type in source: "+type;
	}
}



function rdecode_string(dec) {
	let len = 0;
	const COLON_CHARCODE = ":".charCodeAt(0);
	while (dec.buf[dec.pos+len]!=COLON_CHARCODE) {
		len++;
	}
	const str_len_str = String.fromCharCode.apply(null, dec.buf.subarray(dec.pos, dec.pos+len));
	dec.pos += len+1;
	const str_len = parseInt(str_len_str);
	if (isNaN(str_len)) {
		throw "invalid string length: '"+str_len_str+"'";
	}
	if (str_len==0) {
		return "";
	}
	const str = String.fromCharCode.apply(null, dec.buf.subarray(dec.pos, dec.pos+str_len));
	dec.pos += str_len;
	return str;
}
function rdecode_list(dec) {
	dec.pos++;
	const list = [];
	while (dec.buf[dec.pos]!=RENCODE.CHR_TERM) {
		list.push(_rdecode(dec));
	}
	dec.pos++;
    return list;
}
function rdecode_dict(dec) {
	dec.pos++;
	const dict = {};
	let count = 0;
	while (dec.buf[dec.pos]!=RENCODE.CHR_TERM) {
		const key = _rdecode(dec);
		const value = _rdecode(dec);
		dict[key] = value;
		count++;
	}
	dec.pos++;
	return dict;
}
function rdecode_int(dec) {
	dec.pos++;
	let len = 0;
	while (dec.buf[dec.pos+len]!=RENCODE.CHR_TERM) {
		len++;
	}
	const int_str = String.fromCharCode.apply(null, dec.buf.subarray(dec.pos, dec.pos+len));
	dec.pos += len+1;
	const i = parseInt(int_str);
	if (isNaN(i)) {
		throw "invalid int: '"+int_str+"'";
	}
	return i;
}
function rdecode_intb(dec) {
	let b = dec.buf[dec.pos+1];
	dec.pos += 2;
	return b;
}
function rdecode_inth(dec) {
	let s = dec.buf[dec.pos+1]*256+dec.buf[dec.pos+2]
	dec.pos += 3;
	return s;
}
function rdecode_intl(dec) {
	let l = 0;
	for (let i=0; i<4; i++) {
		l *= 256;
		l += dec.buf[dec.pos+1+i];
	}
	dec.pos += 5;
	return l;
}
function rdecode_intq(dec) {
	let q = 0;
	for (let i=0; i<8; i++) {
		q *= 256;
		q += dec.buf[dec.pos+1+i];
	}
	dec.pos += 9;
	return q;
}
function rdecode_true(dec) {
	dec.pos++;
	return true;
}
function rdecode_false(dec) {
	dec.pos++;
	return false;
}

const decode_func = new Map();
for(let i=0; i<10; i++) {
	const charcode = i.toString().charCodeAt(0);
	decode_func[charcode] = rdecode_string;
}
decode_func[RENCODE.CHR_LIST] = rdecode_list
decode_func[RENCODE.CHR_DICT] = rdecode_dict
decode_func[RENCODE.CHR_INT] = rdecode_int
decode_func[RENCODE.CHR_INT1] = rdecode_intb
decode_func[RENCODE.CHR_INT2] = rdecode_inth
decode_func[RENCODE.CHR_INT4] = rdecode_intl
decode_func[RENCODE.CHR_INT8] = rdecode_intq
decode_func[RENCODE.CHR_TRUE] = rdecode_true
decode_func[RENCODE.CHR_FALSE] = rdecode_false


function make_fixed_length_string_decoder(len) {
    function fixed_length_string_decoder(dec) {
		dec.pos++;
		const str = String.fromCharCode.apply(null, dec.buf.subarray(dec.pos, dec.pos+len));
		dec.pos += len;
		return str;
	}
    return fixed_length_string_decoder;
}
for(let i=0; i<RENCODE.STR_FIXED_COUNT; i++) {
    decode_func[RENCODE.STR_FIXED_START + i] = make_fixed_length_string_decoder(i);
}

function make_fixed_length_list_decoder(len) {
    function fixed_length_list_decoder(dec) {
		dec.pos++;
		let list = [];
		for (let i=0; i<len; i++) {
			list.push(_rdecode(dec));
		}
        return list
	}
	return fixed_length_list_decoder;
}
for(let i=0; i<RENCODE.LIST_FIXED_COUNT; i++) {
    decode_func[RENCODE.LIST_FIXED_START + i] = make_fixed_length_list_decoder(i);
}

function make_fixed_length_dict_decoder(len) {
    function fixed_length_dict_decoder(dec) {
		dec.pos++;
		const dict = {};
		for(let i=0; i<len; i++) {
			const key = _rdecode(dec);
			const value = _rdecode(dec);
			dict[key] = value;
		}
        return dict;
	}
	return fixed_length_dict_decoder;
}
for(let i=0; i<RENCODE.DICT_FIXED_COUNT; i++) {
    decode_func[RENCODE.DICT_FIXED_START + i] = make_fixed_length_dict_decoder(i);
}

function make_int_fixed_decoder(i) {
	function int_fixed_decoder(dec) {
		dec.pos++;
		return i;
	}
	return int_fixed_decoder;
}
for(let i=0; i<RENCODE.INT_POS_FIXED_COUNT; i++) {
    decode_func[RENCODE.INT_POS_FIXED_START + i] = make_int_fixed_decoder(i)
}
for(let i=0; i<RENCODE.INT_NEG_FIXED_COUNT; i++) {
    decode_func[RENCODE.INT_NEG_FIXED_START + i] = make_int_fixed_decoder(-1 - i)
}


class DecodeBuffer {
  constructor(u8a) {
    this.buf = u8a;
    this.pos = 0;
  }
}

function _rdecode(dec) {
	if (dec.pos>=dec.buf.length) {
		throw "reached end of buffer"
	}
	const typecode = dec.buf[dec.pos];
	const decode = decode_func[typecode];
    if (decode === null || decode === undefined) {
		//console.log("buffer pos:", dec.pos);
		//console.log("buffer:", dec.buf.subarray(dec.pos, dec.pos+20))
		//const str = String.fromCharCode.apply(null, dec.buf.subarray(dec.pos, dec.pos+20));
		throw "no decoder for typecode "+typecode+" at position "+dec.pos;
	}
	return decode(dec);
}

function rdecode(buf) {
	const type = typeof buf;
	if (type === "string") {
		const u8a = new Uint8Array(buf.length);
		for(let i=0,j=buf.length;i<j;++i){
			u8a[i] = buf.charCodeAt(i);
		}
		return rdecode(u8a);
	}
    if (type === 'object' && buf.constructor===Uint8Array) {
		return _rdecode(new DecodeBuffer(buf));
	}
	throw "cannot decode "+type;
}
