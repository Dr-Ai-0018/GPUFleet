/**
 * ParticleField — WebGL particle background using Three.js + R3F.
 * Floating particles with subtle connections, reacts to nothing (ambient).
 * Lightweight: ~200 particles, no post-processing.
 */
import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const PARTICLE_COUNT = 180;
const SPREAD = 8;

function Particles(): JSX.Element {
  const meshRef = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const arr = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      arr[i * 3] = (Math.random() - 0.5) * SPREAD;
      arr[i * 3 + 1] = (Math.random() - 0.5) * SPREAD;
      arr[i * 3 + 2] = (Math.random() - 0.5) * SPREAD;
    }
    return arr;
  }, []);

  const sizes = useMemo(() => {
    const arr = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      arr[i] = Math.random() * 2 + 0.5;
    }
    return arr;
  }, []);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime() * 0.15;
    meshRef.current.rotation.y = t;
    meshRef.current.rotation.x = Math.sin(t * 0.5) * 0.1;
  });

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
        <bufferAttribute
          attach="attributes-size"
          args={[sizes, 1]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.03}
        color="#5b8def"
        transparent
        opacity={0.6}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

function FloatingRings(): JSX.Element {
  const ref1 = useRef<THREE.Mesh>(null);
  const ref2 = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref1.current) {
      ref1.current.rotation.x = t * 0.2;
      ref1.current.rotation.z = t * 0.1;
    }
    if (ref2.current) {
      ref2.current.rotation.y = t * 0.15;
      ref2.current.rotation.x = t * 0.08;
    }
  });

  return (
    <>
      <mesh ref={ref1} position={[1.5, 0.5, -2]}>
        <torusGeometry args={[1.2, 0.01, 16, 64]} />
        <meshBasicMaterial color="#5b8def" transparent opacity={0.15} />
      </mesh>
      <mesh ref={ref2} position={[-1, -0.5, -1.5]}>
        <torusGeometry args={[0.8, 0.008, 16, 48]} />
        <meshBasicMaterial color="#7c5bf0" transparent opacity={0.12} />
      </mesh>
    </>
  );
}

export function ParticleField(): JSX.Element {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
      <Canvas
        camera={{ position: [0, 0, 5], fov: 60 }}
        style={{ background: "transparent" }}
        dpr={[1, 1.5]}
        gl={{ antialias: false, alpha: true }}
      >
        <Particles />
        <FloatingRings />
        <ambientLight intensity={0.1} />
      </Canvas>
    </div>
  );
}
