# Physics module

Provide a physics adapter contract rather than hard-coupling the library to one game.
A recommended implementation may use Rapier for rigid-body and collider simulation.
Synchronize simulation transforms with the render rig; avoid duplicate authoritative movement.
