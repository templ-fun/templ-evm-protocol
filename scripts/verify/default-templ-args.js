module.exports = [
  "0x5b87102358a61BC9a6D32b20B121bbfd2A535C8d",  // priest
  "0x123fdE6c36a9E58731491aB4D781c5c999D37918",  // protocol fee recipient
  "0x4200000000000000000000000000000000000006",  // access token
  "10",                                          // entry fee in raw units
  3000,                                          // burn percent (bps)
  3000,                                          // treasury percent (bps)
  3000,                                          // member pool percent (bps)
  1000,                                          // protocol percent (bps)
  3300,                                          // quorum percent (bps)
  604800,                                        // execution delay (sec)
  "0x000000000000000000000000000000000000dEaD",  // burn address
  false,                                         // priestIsDictator
  249,                                           // max members
  "Templ",                                       // templ name
  "",                                            // templ description
  "",                                            // templ logo link
  0,                                             // proposal fee (bps)
  0,                                             // referral share (bps)
  [
    [2, 10094, 0],                               // curveConfig.primary
    []
  ]
];
