# emulate-mongo-2-driver

## Purpose

You have legacy code that depends on the 2.x version of the MongoDB Node.js driver. You don't want to upgrade to the 3.x driver because of [backwards compability problems](https://github.com/mongodb/node-mongodb-native/blob/master/CHANGES_3.0.0.md), but you don't have a choice because of reported vulnerabilities such as those detected by `npm audit`.

`emulate-mongo-2-driver` aims to be a highly compatible emulation of the 2.x version of the MongoDB Node.js driver, implemented as a wrapper for the 3.x driver.

It was created for long term support of [ApostropheCMS 2.x](https://apostrophecms.com). Of course, ApostropheCMS 3.x will use the MongoDB 3.x driver directly.

## Usage

If you are using ApostropheCMS, this is **standard** beginning with version 2.101.0. You don't have to do anything. The example below is for those who wish to use this driver in non-ApostropheCMS projects.

```
npm install emulate-mongo-2-driver
```

```javascript
const mongo = require('emulate-mongo-2-driver');

// Use it here as if it were the 2.x driver
```

## Goals

This module aims for complete compatibility with the [2.x features mentioned as obsolete or changed here](https://github.com/mongodb/node-mongodb-native/blob/master/CHANGES_3.0.0.md) but there may be omissions. An emphasis has been placed on features used by ApostropheCMS but PRs for further compatibility are welcome.

## What about those warnings?

"What about the warnings re: insert, update and ensureIndex operations being obsolete?"

Although deprecated, these operations are supported by the 3.x driver and work just fine.

However, since the preferred newer operations were also supported by the 2.x driver, the path forward is clear. We will migrate away from using them gradually, and you should do the same. It doesn't make sense to provide "deprecation-free" wrappers when doing the right thing is in easy reach.
