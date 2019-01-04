/**
 * This file represents tiny-sdf as was completed at https://github.com/mapbox/tiny-sdf.
 *
 * Here we center the glyph before rendering it as an SDF glyph and we provide a vector to indicate
 * where within the glyph box the character is located. This is in place to aid in kerning, measurement,
 * and precise placement of glyphs.
 */
'use strict';

module.exports = TinySDF;
module.exports.default = TinySDF;

var INF = 1e20;

function TinySDF(fontSize, buffer, radius, cutoff, fontFamily, fontWeight) {
    this.fontSize = fontSize || 24;
    this.buffer = buffer === undefined ? 3 : buffer;
    this.cutoff = cutoff || 0.25;
    this.fontFamily = fontFamily || 'sans-serif';
    this.fontWeight = fontWeight || 'normal';
    this.radius = radius || 8;
    var size = this.size = this.fontSize + this.buffer * 2;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;

    this.ctx = this.canvas.getContext('2d');
    this.ctx.font = this.fontWeight + ' ' + this.fontSize + 'px ' + this.fontFamily;
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = 'black';

    // temporary arrays for the distance transform
    this.gridOuter = new Float64Array(size * size);
    this.gridInner = new Float64Array(size * size);
    this.f = new Float64Array(size);
    this.d = new Float64Array(size);
    this.z = new Float64Array(size + 1);
    this.v = new Int16Array(size);

    // hack around https://bugzilla.mozilla.org/show_bug.cgi?id=737852
    this.middle = Math.round((size / 2) * (navigator.userAgent.indexOf('Gecko/') >= 0 ? 1.2 : 1));
}

TinySDF.prototype.draw = function (char) {
    // Validate input
    if (!char || !char[0]) return new Uint8ClampedArray(0);
    // Ensure a single character is rendered and not a string of chars
    var singleChar = char[0];

    this.ctx.clearRect(0, 0, this.size, this.size);
    this.ctx.fillText(singleChar, this.buffer, this.middle);

    // Center the rendered glyph within our canvas
    var bounds = centerContents(this.ctx);

    var imgData = this.ctx.getImageData(0, 0, this.size, this.size);
    var alphaChannel = new Uint8ClampedArray(this.size * this.size);

    for (var i = 0; i < this.size * this.size; i++) {
        var a = imgData.data[i * 4 + 3] / 255; // alpha value
        this.gridOuter[i] = a === 1 ? 0 : a === 0 ? INF : Math.pow(Math.max(0, 0.5 - a), 2);
        this.gridInner[i] = a === 1 ? INF : a === 0 ? 0 : Math.pow(Math.max(0, a - 0.5), 2);
    }

    edt(this.gridOuter, this.size, this.size, this.f, this.d, this.v, this.z);
    edt(this.gridInner, this.size, this.size, this.f, this.d, this.v, this.z);

    for (i = 0; i < this.size * this.size; i++) {
        var d = this.gridOuter[i] - this.gridInner[i];
        alphaChannel[i] = Math.max(0, Math.min(255, Math.round(255 - 255 * (d / this.radius + this.cutoff))));
    }

    return {
        glyph: alphaChannel,
        bounds: bounds,
    };
};

/**
 * This analyzes the input canvas and centers the rendered character within the canvas
 */
function centerContents(ctx) {
    var size = ctx.canvas.width;
    var bounds = measureContents(ctx);
    var newX = (size - bounds.width) / 2.0;
    var newY = (size - bounds.height) / 2.0;
    var glyphData = ctx.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, size, size);
    ctx.putImageData(glyphData, newX, newY);

    return bounds;
}

/**
 * This measures the contents of what is inside the canvas assumming the rendered values are only white
 */
function measureContents(canvasContext) {
    var width = canvasContext.canvas.width;
    var height = canvasContext.canvas.height;
    var max = Math.max;
    var min = Math.min;
    var imageData = canvasContext.getImageData(0, 0, width, height).data;
    var r;

    var minY = Number.MAX_SAFE_INTEGER;
    var minX = Number.MAX_SAFE_INTEGER;
    var maxX = Number.MIN_SAFE_INTEGER;
    var maxY = Number.MIN_SAFE_INTEGER;

    // Search for first top left pixel that is filled
    for (var i = 0; i < width; ++i) {
        for (var k = 0; k < height; ++k) {
            var redIndex = k * (width * 4) + i * 4;
            r = imageData[redIndex];

            if (r > 0.0) {
                minY = min(minY, k);
                minX = min(minX, i);
                // We found the top left, stop searcing
                i = width;
                k = height;
            }
        }
    }

    // Search for bottom right pixel that is filled
    for (var i = width - 1; i >= 0; --i) {
        for (var k = height - 1; k >= 0; --k) {
            var redIndex = k * (width * 4) + i * 4;
            r = imageData[redIndex];

            if (r > 0.0) {
                maxX = max(maxX, i);
                maxY = max(maxY, k);
                // We found the bottom right, stop searching
                i = -1;
                k = -1;
            }
        }
    }

    // The identified pixel needs to be encased and not a direct target
    minY -= 1;
    maxY += 2;
    maxX += 2;
    minX -= 1;

    minY = max(minY, 0);
    minX = max(minX, 0);

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// 2D Euclidean distance transform by Felzenszwalb & Huttenlocher https://cs.brown.edu/~pff/papers/dt-final.pdf
function edt(data, width, height, f, d, v, z) {
    for (var x = 0; x < width; x++) {
        for (var y = 0; y < height; y++) {
            f[y] = data[y * width + x];
        }
        edt1d(f, d, v, z, height);
        for (y = 0; y < height; y++) {
            data[y * width + x] = d[y];
        }
    }
    for (y = 0; y < height; y++) {
        for (x = 0; x < width; x++) {
            f[x] = data[y * width + x];
        }
        edt1d(f, d, v, z, width);
        for (x = 0; x < width; x++) {
            data[y * width + x] = Math.sqrt(d[x]);
        }
    }
}

// 1D squared distance transform
function edt1d(f, d, v, z, n) {
    v[0] = 0;
    z[0] = -INF;
    z[1] = +INF;

    for (var q = 1, k = 0; q < n; q++) {
        var s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) {
            k--;
            s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        }
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = +INF;
    }

    for (q = 0, k = 0; q < n; q++) {
        while (z[k + 1] < q) k++;
        d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
}
