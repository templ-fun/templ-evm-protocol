module.exports = {
  istanbulFolder: 'coverage/contracts',
  // Be explicit so mocks never affect protocol coverage
  skipFiles: [
    // Paths are relative to the contracts/ directory used by solidity-coverage
    'mocks/**'
  ]
};
