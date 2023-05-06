const byteToHex: Array<string> = [];

for (let n = 0; n <= 0xff; ++n)
{
    const hexOctet = n.toString(16).padStart(2, "0");
    byteToHex.push(hexOctet);
}

export function hex(arrayBuffer: ArrayBuffer)
{
    const buff = new Uint8Array(arrayBuffer);
    const hexOctets = new Array(buff.length);

    for (let i = 0; i < buff.length; ++i)
        hexOctets[i] = byteToHex[buff[i]];

    return hexOctets.join("");
}

export function normalizeHex(hash: string): string {
	return hash
		.toLowerCase()
		.split("")
		.filter(ch => ('0' <= ch && ch <= 'f'))
		.join("");
}

export function encodeBase64(arrayBuffer: ArrayBuffer): string {
    var binary = '';
    var bytes = new Uint8Array(arrayBuffer);
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
        binary += String.fromCharCode( bytes[ i ] );
    }
    return btoa( binary );
}