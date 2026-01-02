<?php


class Test {

/**
 *
 * @param mixed $x
 * @return int|float
 */
function testc($x)
{
    // Missing return type
    return $x * 1;
}

/**
 *
 * @param mixed $x
 * @return int|float
 */
function testa($x)
{
    // Missing return type
    return $x * 2;
}

/**
 *
 * @return int|float
 */
function testb()
{
    // Missing return type
    return 3;
}
}

$unused = 42; // Unused variable

echo test(5);

$test = new Test();

$test->testa(fn() => $test->testb());