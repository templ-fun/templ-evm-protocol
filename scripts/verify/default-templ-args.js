     module.exports = [
       "0x5b87102358a61BC9a6D32b20B121bbfd2A535C8d",
       "0x123fdE6c36a9E58731491aB4D781c5c999D37918",
       "0x4200000000000000000000000000000000000006",
       "10",    // entry fee in raw units
       3000,                      // burn percent (bps)
       3000,                      // treasury percent (bps)
       3000,                      // member pool percent (bps)
       1000,                      // protocol percent (bps)
       3300,                      // quorum percent (bps)
       604800,                    // execution delay (sec)
       "0x000000000000000000000000000000000000dEaD",
       false,                     // priestIsDictator
       249,                       // max members
       "",                        // home link (if you left it blank)
       [
         [2, 10094]               // curveConfig.primary: style=2 (Exponential), rateBps=10094
       ]
     ];