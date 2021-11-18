// FIXME: this should be upstreamed into the buffer module

module.exports.monkeyPatchBox2Libs = () => {
  Uint8Array.prototype.equals = function equals (b) {
    let a = this

    if (a === b) {
      return true
    }

    if (a.byteLength !== b.byteLength) {
      return false
    }

    for (let i = 0; i < a.byteLength; i++) {
      if (a[i] !== b[i]) {
        return false
      }
    }

    return true
  }

  Uint8Array.prototype.copy = function equals (b) {
    let a = this
    for (let i = 0; i < a.length; ++i)
      b[i] = a[i]
  }
}
