// Ethers v6 adapter for compatibility
// This file bridges ethers v6 to work with code written for v5

if (typeof ethers !== 'undefined') {
    // Add v5 compatibility aliases
    if (!ethers.providers) {
        ethers.providers = {};
        ethers.providers.Web3Provider = ethers.BrowserProvider;
    }
    
    if (!ethers.utils) {
        ethers.utils = {
            formatUnits: ethers.formatUnits,
            parseUnits: ethers.parseUnits,
            formatEther: ethers.formatEther,
            parseEther: ethers.parseEther,
            id: ethers.id,
            keccak256: ethers.keccak256,
            defaultAbiCoder: ethers.AbiCoder.defaultAbiCoder(),
            toUtf8Bytes: ethers.toUtf8Bytes,
            toUtf8String: ethers.toUtf8String,
            hexlify: ethers.hexlify,
            hexValue: ethers.toQuantity,
            Interface: ethers.Interface,
            verifyMessage: ethers.verifyMessage
        };
    }
    
    if (!ethers.BigNumber) {
        ethers.BigNumber = {
            from: (value) => BigInt(value),
            isBigNumber: (value) => typeof value === 'bigint'
        };
    }
    
    // Patch BigInt prototype to add v5-like methods
    if (!BigInt.prototype.mul) {
        BigInt.prototype.mul = function(other) {
            return this * BigInt(other);
        };
        BigInt.prototype.div = function(other) {
            return this / BigInt(other);
        };
        BigInt.prototype.add = function(other) {
            return this + BigInt(other);
        };
        BigInt.prototype.sub = function(other) {
            return this - BigInt(other);
        };
        BigInt.prototype.pow = function(other) {
            return this ** BigInt(other);
        };
        BigInt.prototype.lt = function(other) {
            return this < BigInt(other);
        };
        BigInt.prototype.lte = function(other) {
            return this <= BigInt(other);
        };
        BigInt.prototype.gt = function(other) {
            return this > BigInt(other);
        };
        BigInt.prototype.gte = function(other) {
            return this >= BigInt(other);
        };
        BigInt.prototype.eq = function(other) {
            return this === BigInt(other);
        };
        BigInt.prototype.toString = function() {
            return String(this);
        };
        BigInt.prototype.toNumber = function() {
            return Number(this);
        };
    }
    
    console.log('Ethers v6 compatibility layer loaded');
}