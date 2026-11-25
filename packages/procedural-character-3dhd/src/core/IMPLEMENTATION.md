# Implementation roadmap

This directory is reserved for the public React character renderer and factory.

The initial extraction must avoid coupling the library to Splatterhouse-specific weapon IDs,
combat states, scene layout or game-only assets. Keep game-specific behavior in an adapter.

The renderer should expose a configurable character root and forward refs to the rig/controller.
