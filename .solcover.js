const config = {
  istanbulFolder: 'coverage/contracts',
  skipFiles: ['mocks']
};

export default config;

if (typeof module !== 'undefined') {
  module.exports = config;
}
