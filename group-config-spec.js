const Overwrite = require('@tangle/overwrite')
const SimpleSet = require('@tangle/simple-set')

module.exports = {
  spec: {
    type: 'groupconfig',
    props: {
      title: Overwrite(),
      rooms: SimpleSet()
    }
  }
}
