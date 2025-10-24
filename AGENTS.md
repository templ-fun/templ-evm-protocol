HOW TO ACHIEVE SUCCESS AS AN LLM WORKING IN TEMPL CODEBASE

1) before starting a task at least read the project readme so you understand a bit of our business domain, go deeper in code as needed

2) before handing over a finished task always make sure readme, natspec, and tests are updated and npm test passes. never leave comments about old implementations and removed things, always just state things as if they are the only version that ever existed
   
3) when editing README mind the streamlining of new-readers understanding and learning the protocol as a whole, don't just add a point exclusively about the new feature, insert it in a way it reads as part of the whole that was always there
   
4) never care about compatibility with past deploys or external services, we are building this from 0 -> 1 no one uses it yet, so never leave traces about this in your edits

5) tests should never jerry-rig something that is not really testing how prod works, tests should always strive to give us complete trust in our codebase and that it correctly performs our business intentions

6) if you are going to run commands read package.json to make sure you run the correct scripts if they exist before invoking external npx calls for things we already have

7) protocol security is #1 priority, whenever developing anything always think in extremely adversarial use-cases of that feature, templs should never be open to griefing outside its own governance rules, if any change may create a security hole stop and be explicit about it so we can think together

8) Solidity style: never leave inline `//` or `/* */` comments in contract code. Use NatSpec (`///` and `/** ... */`) for all documentation. Remove stray inline comments during reviews/patches.
