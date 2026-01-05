# Inconsistencies

Findings
- UI guide says disband treasury proposals are quorum-exempt only when proposed by the priest, but the contract also grants quorum exemption to council members. References: UI.md:238, contracts/TemplGovernance.sol:332-351.
- README lists TemplDefaults as only quorum/post-quorum/burn defaults, but the library also defines defaults for yes-vote threshold and instant quorum. References: README.md:564, contracts/TemplDefaults.sol:8-12.
- README implies factory defaults apply in createTemplWithConfig via the -1 sentinel (including maxMembers=249), but CreateConfig treats maxMembers=0 as uncapped and createTemplWithConfig does not auto-fill maxMembers. References: README.md:572-575, contracts/TemplFactory.sol:305-320, contracts/TemplFactoryTypes.sol:29-30.