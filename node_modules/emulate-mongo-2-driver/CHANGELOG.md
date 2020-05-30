## 1.2.3

* Fixed issue that caused `count` to disregard its criteria object in at least some cases.
* The `.db` method of a database object now works as it does with the 2.x driver, even if
used to create a third generation of object.

## 1.2.2

* Fixed issue when calling `aggregate` with a `cursor` option. Thanks to Mohamad Yusri for identifying the issue.
* Fixed issue when calling `aggregate` with no callback and no cursor option. Thanks again to Mohamad Yusri for identifying the issue.

## 1.2.1

* Fixed incompatible default behavior for `aggregate()`. Although the 2.x mongodb driver documentation suggests it would not return a cursor when the cursor option is not present, it actually does so at any time when there is no callback provided. This broke certain workflow scenarios in Apostrophe.

## 1.2.0

* Deprecation warning eliminated for `count` via use of `countDocuments` where possible, and where not (use of `$near` with `count` for instance), fetching of all `_id` properties as a minimal projection to arrive at a count.
* Fixed bugs in wrapper for `aggregate()`.
* Support for `cursor: true` option to `aggregate()`.

## 1.1.0

* Deprecation warnings eliminated through emulation of all of the common deprecated methods. Test coverage included. A warning will still appear if you do not pass `useUnifiedTopology: true`. See the README for details on how to do that in ApostropheCMS.
* Three options passed by Apostrpohe that are neither valid nor meaningful with `useUnifiedTopology: true` are automatically discarded when it is present, to prevent more deprecation warnings.

## 1.0.4

Node 13.x compatibility. Resolves [this bug report](https://github.com/apostrophecms/apostrophe/issues/2120).

## 1.0.3

URI tolerance change from 1.0.2 now covers connect() with a promise as well.

## 1.0.2

Tolerate MongoDB URIs that break the WHATWG URL parser.

## 1.0.1

We no longer set `useNewUrlParser` and `useUnifiedTopology` by default. These caused bc breaks for some and while the old parser and topology generate deprecation warnings they work correctly with 2.x code. We shouldn't default these on again unless we've added measures to mitigate incompatibilities with 2.x code.

## 1.0.0

Initial release.
